import {
  ChangePlan,
  ChangeMatchCount,
} from "../core/change-plan";
import {
  validateAndroidVersionCode,
  validatePositiveBuildVersion,
  validateSemanticVersion,
} from "../core/version";
import {
  createAndroidChangePlan,
  parseAndroidBuildGradle,
  readAndroidBuildGradle,
} from "../lib/android";
import { BumpVersionError } from "../lib/errors";
import {
  createIOSChangePlan,
  IOSSelectionOptions,
  parseIOSConfig,
  readIOSConfig,
} from "../lib/ios";
import {
  CommitTarget,
  commitChangePlans,
} from "../lib/safe-write";
import { AndroidConfig, IOSConfig } from "../types/types";
import {
  portableRelativePath,
  resolveAndroidFile,
  resolveIOSFile,
  resolveProjectRoot,
} from "./paths";
import { loadAutomationConfig, mergeAutomationOptions } from "./config";

export type AutomationCommand = "inspect" | "set" | "bump" | "check";
export type AutomationPlatform = "android" | "ios" | "all";
export type ReleaseType = "major" | "minor" | "patch";

export interface AutomationOptions {
  root?: string;
  platform?: string;
  dryRun?: boolean;
  nonInteractive?: boolean;
  allowDowngrade?: boolean;
  appVersion?: string;
  versionName?: string;
  versionCode?: string;
  marketingVersion?: string;
  buildNumber?: string;
  androidFile?: string;
  androidModule?: string;
  iosProject?: string;
  iosTarget?: string;
  iosConfiguration?: string;
  allTargets?: boolean;
  release?: string;
  incrementBuild?: boolean;
  format?: string;
  outputFile?: string;
  quiet?: boolean;
  debug?: boolean;
  color?: boolean;
  config?: string;
}

export interface AndroidOperationState {
  versionName: string;
  versionCode: number;
}

export interface IOSOperationState {
  marketingVersion: string;
  buildNumber: string;
}

export interface PlatformOperationResult<TState> {
  path: string;
  before: TState;
  after: TState;
  matches: ChangeMatchCount;
  changed: boolean;
  selection?: IOSSelectionOptions;
}

export interface AutomationResult {
  command: AutomationCommand;
  changed: boolean;
  dryRun: boolean;
  root: string;
  platforms: {
    android?: PlatformOperationResult<AndroidOperationState>;
    ios?: PlatformOperationResult<IOSOperationState>;
  };
  warnings: string[];
}

type MobileConfig = AndroidConfig | IOSConfig;
type MobilePlan = ChangePlan<AndroidConfig> | ChangePlan<IOSConfig>;

interface PlannedTarget {
  platform: "android" | "ios";
  plan: MobilePlan;
  iosSelection?: IOSSelectionOptions;
}

function iosSelectionFromOptions(
  options: AutomationOptions
): IOSSelectionOptions {
  return {
    ...(options.iosTarget ? { target: options.iosTarget } : {}),
    ...(options.iosConfiguration
      ? { configuration: options.iosConfiguration }
      : {}),
    ...(options.allTargets ? { allTargets: true } : {}),
  };
}

function hasIOSSelection(selection: IOSSelectionOptions): boolean {
  return Boolean(
    selection.target || selection.configuration || selection.allTargets
  );
}

function validateIOSSelectionOptions(
  platform: AutomationPlatform,
  values: AutomationOptions
): void {
  const selection = iosSelectionFromOptions(values);

  if (selection.target && selection.allTargets) {
    throw new BumpVersionError(
      "VALIDATION_ERROR",
      "--ios-target and --all-targets cannot be used together.",
      "--ios-target"
    );
  }

  if (platform === "android" && hasIOSSelection(selection)) {
    throw new BumpVersionError(
      "VALIDATION_ERROR",
      "iOS target/configuration options require --platform ios or all.",
      "--platform"
    );
  }
}

function parsePlatform(value: string | undefined): AutomationPlatform {
  const platform = value ?? "all";

  if (platform !== "android" && platform !== "ios" && platform !== "all") {
    throw new BumpVersionError(
      "VALIDATION_ERROR",
      "--platform must be android, ios or all.",
      "platform"
    );
  }

  return platform;
}

function selectedPlatforms(
  platform: AutomationPlatform
): Array<"android" | "ios"> {
  return platform === "all" ? ["android", "ios"] : [platform];
}

function requiredValue(value: string | undefined, flag: string): string {
  if (value === undefined || value === "") {
    throw new BumpVersionError(
      "VALIDATION_ERROR",
      `Missing required option ${flag}.`,
      flag
    );
  }

  return value;
}

function parseRelease(value: string | undefined): ReleaseType {
  if (value !== "major" && value !== "minor" && value !== "patch") {
    throw new BumpVersionError(
      "VALIDATION_ERROR",
      "--release must be major, minor or patch.",
      "release"
    );
  }

  return value;
}

function bumpSemanticVersion(value: string, release: ReleaseType): string {
  validateSemanticVersion(value, "Android");
  let [major, minor, patch] = value.split(".").map((part) => BigInt(part));

  if (release === "major") {
    major += 1n;
    minor = 0n;
    patch = 0n;
  } else if (release === "minor") {
    minor += 1n;
    patch = 0n;
  } else {
    patch += 1n;
  }

  return `${major}.${minor}.${patch}`;
}

function incrementPositiveInteger(value: string, field: string): string {
  const normalized = validatePositiveBuildVersion(value, field);
  const incremented = Number(normalized) + 1;

  if (!Number.isSafeInteger(incremented)) {
    throw new BumpVersionError(
      "VERSION_CONFLICT",
      `Cannot increment ${field} beyond the safe integer range.`,
      field
    );
  }

  return String(incremented);
}

function toAndroidState(config: AndroidConfig): AndroidOperationState {
  return {
    versionName: config.marketingVersion,
    versionCode: Number(config.buildVersion),
  };
}

function toIOSState(config: IOSConfig): IOSOperationState {
  return {
    marketingVersion: config.MARKETING_VERSION,
    buildNumber: config.CURRENT_PROJECT_VERSION,
  };
}

function resultFromTargets(options: {
  command: AutomationCommand;
  root: string;
  dryRun: boolean;
  targets: PlannedTarget[];
}): AutomationResult {
  const platforms: AutomationResult["platforms"] = {};

  for (const target of options.targets) {
    if (target.platform === "android") {
      const plan = target.plan as ChangePlan<AndroidConfig>;
      platforms.android = {
        path: portableRelativePath(options.root, plan.path),
        before: toAndroidState(plan.before),
        after: toAndroidState(plan.after),
        matches: plan.matches,
        changed: plan.changed,
      };
    } else {
      const plan = target.plan as ChangePlan<IOSConfig>;
      platforms.ios = {
        path: portableRelativePath(options.root, plan.path),
        before: toIOSState(plan.before),
        after: toIOSState(plan.after),
        matches: plan.matches,
        changed: plan.changed,
        ...(target.iosSelection && hasIOSSelection(target.iosSelection)
          ? { selection: target.iosSelection }
          : {}),
      };
    }
  }

  return {
    command: options.command,
    changed: options.targets.some(({ plan }) => plan.changed),
    dryRun: options.dryRun,
    root: options.root,
    platforms,
    warnings: [],
  };
}

function commitTargets(targets: PlannedTarget[]): void {
  const commitTargets: Array<CommitTarget<MobileConfig>> = targets.map(
    (target) => ({
      plan: target.plan as ChangePlan<MobileConfig>,
      parseConfig:
        target.platform === "android"
          ? (content, path) => parseAndroidBuildGradle(content, path)
          : (content, path) =>
              parseIOSConfig(content, path, target.iosSelection),
    })
  );

  commitChangePlans(commitTargets);
}

function inspectTargets(options: {
  root: string;
  platform: AutomationPlatform;
  values: AutomationOptions;
}): PlannedTarget[] {
  const targets: PlannedTarget[] = [];

  for (const platform of selectedPlatforms(options.platform)) {
    if (platform === "android") {
      const path = resolveAndroidFile({
        root: options.root,
        androidFile: options.values.androidFile,
        androidModule: options.values.androidModule,
      });
      const current = readAndroidBuildGradle(path);
      targets.push({
        platform,
        plan: createAndroidChangePlan(
          path,
          current.buildVersion,
          current.marketingVersion
        ),
      });
    } else {
      const selection = iosSelectionFromOptions(options.values);
      const path = resolveIOSFile({
        root: options.root,
        iosProject: options.values.iosProject,
      });
      const current = readIOSConfig(path, selection);
      targets.push({
        platform,
        plan: createIOSChangePlan(
          path,
          current.CURRENT_PROJECT_VERSION,
          current.MARKETING_VERSION,
          selection
        ),
        iosSelection: selection,
      });
    }
  }

  return targets;
}

function setTargets(options: {
  root: string;
  platform: AutomationPlatform;
  values: AutomationOptions;
}): PlannedTarget[] {
  const targets: PlannedTarget[] = [];

  for (const platform of selectedPlatforms(options.platform)) {
    if (platform === "android") {
      const path = resolveAndroidFile({
        root: options.root,
        androidFile: options.values.androidFile,
        androidModule: options.values.androidModule,
      });
      const versionName = requiredValue(
        options.values.versionName ?? options.values.appVersion,
        "--version-name or --app-version"
      );
      const versionCode = requiredValue(
        options.values.versionCode,
        "--version-code"
      );
      targets.push({
        platform,
        plan: createAndroidChangePlan(path, versionCode, versionName, {
          allowDowngrade: options.values.allowDowngrade,
        }),
      });
    } else {
      const selection = iosSelectionFromOptions(options.values);
      const path = resolveIOSFile({
        root: options.root,
        iosProject: options.values.iosProject,
      });
      const marketingVersion = requiredValue(
        options.values.marketingVersion ?? options.values.appVersion,
        "--marketing-version or --app-version"
      );
      const buildNumber = requiredValue(
        options.values.buildNumber,
        "--build-number"
      );
      targets.push({
        platform,
        plan: createIOSChangePlan(
          path,
          buildNumber,
          marketingVersion,
          selection
        ),
        iosSelection: selection,
      });
    }
  }

  return targets;
}

function bumpTargets(options: {
  root: string;
  platform: AutomationPlatform;
  values: AutomationOptions;
}): PlannedTarget[] {
  const release = parseRelease(options.values.release);
  const inspected = inspectTargets(options);

  if (options.platform === "all") {
    const android = inspected.find(({ platform }) => platform === "android")!
      .plan as ChangePlan<AndroidConfig>;
    const ios = inspected.find(({ platform }) => platform === "ios")!
      .plan as ChangePlan<IOSConfig>;

    if (android.before.marketingVersion !== ios.before.MARKETING_VERSION) {
      throw new BumpVersionError(
        "VERSION_CONFLICT",
        "Android and iOS marketing versions differ; synchronize or bump one platform explicitly.",
        options.root,
        undefined,
        {
          android: android.before.marketingVersion,
          ios: ios.before.MARKETING_VERSION,
        }
      );
    }
  }

  return inspected.map((target) => {
    if (target.platform === "android") {
      const current = (target.plan as ChangePlan<AndroidConfig>).before;
      const versionName = bumpSemanticVersion(
        current.marketingVersion,
        release
      );
      const versionCode = options.values.versionCode
        ? options.values.versionCode
        : options.values.incrementBuild
        ? incrementPositiveInteger(current.buildVersion, "versionCode")
        : current.buildVersion;

      return {
        platform: "android" as const,
        plan: createAndroidChangePlan(
          target.plan.path,
          versionCode,
          versionName,
          { allowDowngrade: options.values.allowDowngrade }
        ),
      };
    }

    const current = (target.plan as ChangePlan<IOSConfig>).before;
    const marketingVersion = bumpSemanticVersion(
      current.MARKETING_VERSION,
      release
    );
    const buildNumber = options.values.buildNumber
      ? options.values.buildNumber
      : options.values.incrementBuild
      ? incrementPositiveInteger(
          current.CURRENT_PROJECT_VERSION,
          "CURRENT_PROJECT_VERSION"
        )
      : current.CURRENT_PROJECT_VERSION;

    return {
      platform: "ios" as const,
      plan: createIOSChangePlan(
        target.plan.path,
        buildNumber,
        marketingVersion,
        target.iosSelection
      ),
      iosSelection: target.iosSelection,
    };
  });
}

function checkTargets(options: {
  root: string;
  platform: AutomationPlatform;
  values: AutomationOptions;
}): PlannedTarget[] {
  const targets = inspectTargets(options);
  let compared = false;

  for (const target of targets) {
    if (target.platform === "android") {
      const current = (target.plan as ChangePlan<AndroidConfig>).before;
      const expectedVersion =
        options.values.versionName ?? options.values.appVersion;
      const expectedCode = options.values.versionCode;

      if (expectedVersion !== undefined) {
        compared = true;
        validateSemanticVersion(expectedVersion, "Android");

        if (current.marketingVersion !== expectedVersion) {
          throw new BumpVersionError(
            "CHECK_MISMATCH",
            `Expected Android versionName ${expectedVersion}, found ${current.marketingVersion}.`,
            target.plan.path,
            undefined,
            { expected: expectedVersion, actual: current.marketingVersion }
          );
        }
      }

      if (expectedCode !== undefined) {
        compared = true;
        const normalized = validateAndroidVersionCode(expectedCode);

        if (current.buildVersion !== normalized) {
          throw new BumpVersionError(
            "CHECK_MISMATCH",
            `Expected Android versionCode ${normalized}, found ${current.buildVersion}.`,
            target.plan.path,
            undefined,
            { expected: normalized, actual: current.buildVersion }
          );
        }
      }
    } else {
      const current = (target.plan as ChangePlan<IOSConfig>).before;
      const expectedVersion =
        options.values.marketingVersion ?? options.values.appVersion;
      const expectedBuild = options.values.buildNumber;

      if (expectedVersion !== undefined) {
        compared = true;
        validateSemanticVersion(expectedVersion, "iOS");

        if (current.MARKETING_VERSION !== expectedVersion) {
          throw new BumpVersionError(
            "CHECK_MISMATCH",
            `Expected iOS marketing version ${expectedVersion}, found ${current.MARKETING_VERSION}.`,
            target.plan.path,
            undefined,
            { expected: expectedVersion, actual: current.MARKETING_VERSION }
          );
        }
      }

      if (expectedBuild !== undefined) {
        compared = true;
        const normalized = validatePositiveBuildVersion(
          expectedBuild,
          "buildNumber"
        );

        if (current.CURRENT_PROJECT_VERSION !== normalized) {
          throw new BumpVersionError(
            "CHECK_MISMATCH",
            `Expected iOS build number ${normalized}, found ${current.CURRENT_PROJECT_VERSION}.`,
            target.plan.path,
            undefined,
            { expected: normalized, actual: current.CURRENT_PROJECT_VERSION }
          );
        }
      }
    }
  }

  if (!compared) {
    throw new BumpVersionError(
      "VALIDATION_ERROR",
      "check requires at least one expected version option.",
      "check"
    );
  }

  return targets;
}

export function executeAutomation(
  command: AutomationCommand,
  options: AutomationOptions,
  cwd: string
): AutomationResult {
  const root = resolveProjectRoot(cwd, options.root);
  const config = loadAutomationConfig(root, options.config);
  const values = mergeAutomationOptions(config, options);
  const platform = parsePlatform(values.platform);
  validateIOSSelectionOptions(platform, values);
  let targets: PlannedTarget[];

  if (command === "inspect") {
    targets = inspectTargets({ root, platform, values });
  } else if (command === "set") {
    targets = setTargets({ root, platform, values });
  } else if (command === "bump") {
    targets = bumpTargets({ root, platform, values });
  } else {
    targets = checkTargets({ root, platform, values });
  }

  const dryRun = values.dryRun ?? false;

  if (command === "set" || command === "bump") {
    if (!dryRun) {
      commitTargets(targets);
    }
  }

  return resultFromTargets({ command, root, dryRun, targets });
}
