import { createError } from "./errors";
import {
  findProjectFile,
  loadConfig,
  relativeInsideRoot,
  resolveOutputPath,
  resolveRoot,
} from "./project";
import {
  analyzePlatform,
  commitPlans,
  createPlan,
  planChanged,
  planMatches,
  type ChangePlan,
} from "./transaction";
import {
  isExplicitSelection,
  selectionDocument,
  type AndroidState,
  type AutomationCommand,
  type AutomationOptions,
  type AutomationResult,
  type Host,
  type IosState,
  type LegacyPlanResult,
  type LegacyReadRequest,
  type LegacyUpdateRequest,
  type Platform,
  type ReleaseType,
  type Selection,
  type Versions,
} from "./types";
import {
  bumpSemanticVersion,
  MAX_SAFE_BUILD,
  parsePositiveBuild,
  platformDisplayName,
  validateAndroidVersionCode,
  validateSemanticVersion,
} from "./version";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function requireOption(value: string | undefined, flag: string): string {
  if (value === undefined || value.length === 0) {
    throw createError(
      "VALIDATION_ERROR",
      `Missing required option ${flag}.`,
      flag,
    );
  }
  return value;
}

function compareExpected(
  actual: string,
  expected: string,
  label: string,
  path: string,
): void {
  if (actual !== expected) {
    throw createError(
      "CHECK_MISMATCH",
      `Expected ${label} ${expected}, found ${actual}.`,
      path,
      { expected, actual },
    );
  }
}

function androidState(versions: Versions): AndroidState {
  return {
    versionName: versions.marketing,
    versionCode: Number(versions.build),
  };
}

function iosState(versions: Versions): IosState {
  return {
    marketingVersion: versions.marketing,
    buildNumber: versions.build,
  };
}

function isReleaseType(value: string | undefined): value is ReleaseType {
  return value === "major" || value === "minor" || value === "patch";
}

export function runAutomation(
  host: Host,
  command: AutomationCommand,
  flags: AutomationOptions,
  cwd: string,
): AutomationResult {
  const root = resolveRoot(host, cwd, flags.root ?? ".");
  const options = loadConfig(host, root, flags);

  const selection: Selection = {
    ...(options.iosTarget !== undefined ? { target: options.iosTarget } : {}),
    ...(options.iosConfiguration !== undefined
      ? { configuration: options.iosConfiguration }
      : {}),
    allTargets: options.allTargets === true,
  };

  const platformOption = options.platform ?? "all";
  let platforms: readonly Platform[];
  if (platformOption === "all") {
    platforms = ["android", "ios"];
  } else if (platformOption === "android") {
    platforms = ["android"];
  } else if (platformOption === "ios") {
    platforms = ["ios"];
  } else {
    throw createError(
      "VALIDATION_ERROR",
      "--platform must be android, ios or all.",
      "platform",
    );
  }

  if (selection.allTargets && selection.target !== undefined) {
    throw createError(
      "VALIDATION_ERROR",
      "--ios-target and --all-targets cannot be used together.",
      "--ios-target",
    );
  }

  if (
    isExplicitSelection(selection) &&
    platforms.length === 1 &&
    platforms[0] === "android"
  ) {
    throw createError(
      "VALIDATION_ERROR",
      "iOS target/configuration options require --platform ios or all.",
      "--platform",
    );
  }

  const release = options.release;
  if (command === "bump" && !isReleaseType(release)) {
    throw createError(
      "VALIDATION_ERROR",
      "--release must be major, minor or patch.",
      "release",
    );
  }

  const outputPath =
    options.outputFile !== undefined
      ? resolveOutputPath(host, root, options.outputFile)
      : undefined;

  let compared = false;
  const plans: ChangePlan[] = [];
  const results: AutomationResult["platforms"] = {};

  for (const platform of platforms) {
    const filePath = findProjectFile(host, root, platform, options);

    if (outputPath !== undefined) {
      let canonicalOutput: string | undefined;
      try {
        canonicalOutput = host.canonical(outputPath);
      } catch {
        canonicalOutput = undefined;
      }
      if (outputPath === filePath || canonicalOutput === filePath) {
        throw createError(
          "VALIDATION_ERROR",
          "--output-file must be distinct from the project file.",
          outputPath,
        );
      }
    }

    let text: string;
    try {
      text = host.read(filePath);
    } catch (error) {
      throw createError("PARSE_ERROR", errorMessage(error), filePath);
    }

    const source = analyzePlatform(platform, text, filePath, selection);
    const current = source.current;
    const isAndroid = platform === "android";

    const marketingOption =
      (isAndroid ? options.versionName : options.marketingVersion) ??
      options.appVersion;
    const buildOption = isAndroid ? options.versionCode : options.buildNumber;
    const marketingFlag = isAndroid
      ? "--version-name or --app-version"
      : "--marketing-version or --app-version";
    const buildFlag = isAndroid ? "--version-code" : "--build-number";
    const marketingLabel = isAndroid
      ? "Android versionName"
      : "iOS marketing version";
    const buildLabel = isAndroid ? "Android versionCode" : "iOS build number";

    const desired: Versions = {
      build: current.build,
      marketing: current.marketing,
    };

    switch (command) {
      case "set":
        desired.marketing = requireOption(marketingOption, marketingFlag);
        desired.build = requireOption(buildOption, buildFlag);
        break;

      case "bump":
        desired.marketing = bumpSemanticVersion(
          current.marketing,
          release as ReleaseType,
        );
        if (buildOption !== undefined) {
          desired.build = buildOption;
        } else if (options.incrementBuild === true) {
          const field = isAndroid ? "versionCode" : "CURRENT_PROJECT_VERSION";
          const currentBuild = parsePositiveBuild(current.build, field);
          if (currentBuild === MAX_SAFE_BUILD) {
            throw createError(
              "VERSION_CONFLICT",
              `Cannot increment ${field} beyond the safe integer range.`,
              field,
            );
          }
          desired.build = String(currentBuild + 1);
        }
        break;

      case "check":
        if (marketingOption !== undefined) {
          compared = true;
          validateSemanticVersion(
            marketingOption,
            platformDisplayName(platform),
          );
          compareExpected(
            current.marketing,
            marketingOption,
            marketingLabel,
            filePath,
          );
        }
        if (buildOption !== undefined) {
          compared = true;
          const normalized = isAndroid
            ? validateAndroidVersionCode(buildOption, undefined, false)
            : parsePositiveBuild(buildOption, "buildNumber");
          compareExpected(
            current.build,
            String(normalized),
            buildLabel,
            filePath,
          );
        }
        break;

      case "inspect":
        break;
    }

    const plan = createPlan(
      platform,
      filePath,
      selection,
      text,
      source,
      desired,
      options.allowDowngrade === true,
    );

    const relativePath = relativeInsideRoot(host, root, plan.path);
    const matches = planMatches(plan);
    const changed = planChanged(plan);

    if (isAndroid) {
      results.android = {
        path: relativePath,
        before: androidState(plan.original),
        after: androidState(plan.requested),
        matches,
        changed,
      };
    } else {
      results.ios = {
        path: relativePath,
        ...(isExplicitSelection(selection)
          ? { selection: selectionDocument(selection) }
          : {}),
        before: iosState(plan.original),
        after: iosState(plan.requested),
        matches,
        changed,
      };
    }

    plans.push(plan);
  }

  if (command === "check" && !compared) {
    throw createError(
      "VALIDATION_ERROR",
      "check requires at least one expected version option.",
      "check",
    );
  }

  if (command === "bump" && plans.length === 2) {
    const [androidPlan, iosPlan] = plans;
    if (androidPlan!.original.marketing !== iosPlan!.original.marketing) {
      throw createError(
        "VERSION_CONFLICT",
        "Android and iOS marketing versions differ; synchronize or bump one platform explicitly.",
        root,
        {
          android: androidPlan!.original.marketing,
          ios: iosPlan!.original.marketing,
        },
      );
    }
  }

  if ((command === "bump" || command === "set") && options.dryRun !== true) {
    commitPlans(host, plans);
  }

  return {
    command,
    changed: plans.some(planChanged),
    dryRun: options.dryRun === true,
    root,
    platforms: results,
    warnings: [],
  };
}

export function runLegacyRead(host: Host, req: LegacyReadRequest): Versions {
  const root = resolveRoot(host, req.cwd, ".");
  const selector: AutomationOptions =
    req.platform === "android"
      ? { androidFile: "android/app/build.gradle" }
      : { iosProject: `ios/${req.name ?? ""}.xcodeproj/project.pbxproj` };
  const filePath = findProjectFile(host, root, req.platform, selector);
  let text: string;
  try {
    text = host.read(filePath);
  } catch (error) {
    throw createError("PARSE_ERROR", errorMessage(error), filePath);
  }
  const source = analyzePlatform(req.platform, text, filePath, {
    allTargets: false,
  });
  return source.current;
}

export function runLegacyUpdate(
  host: Host,
  req: LegacyUpdateRequest,
): LegacyPlanResult {
  const root = resolveRoot(host, req.cwd, ".");
  const selector: AutomationOptions =
    req.platform === "android"
      ? { androidFile: "android/app/build.gradle" }
      : { iosProject: `ios/${req.name ?? ""}.xcodeproj/project.pbxproj` };
  const filePath = findProjectFile(host, root, req.platform, selector);
  let text: string;
  try {
    text = host.read(filePath);
  } catch (error) {
    throw createError("PARSE_ERROR", errorMessage(error), filePath);
  }
  const selection: Selection = { allTargets: false };
  const source = analyzePlatform(req.platform, text, filePath, selection);
  const plan = createPlan(
    req.platform,
    filePath,
    selection,
    text,
    source,
    { build: req.build, marketing: req.marketing },
    req.allowDowngrade === true,
  );
  if (req.dryRun !== true) {
    commitPlans(host, [plan]);
  }
  return {
    platform: req.platform,
    path: plan.path,
    before: plan.original,
    after: plan.requested,
    matches: planMatches(plan),
    changed: planChanged(plan),
  };
}
