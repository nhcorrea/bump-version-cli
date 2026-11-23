import { createError, type ErrorCode } from "./errors";
import type { AutomationOptions, Host, Platform } from "./types";

function callOrThrow<T>(
  fn: () => T,
  code: ErrorCode,
  message: string,
  path: string,
): T {
  try {
    return fn();
  } catch {
    throw createError(code, message, path);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function resolveRoot(host: Host, cwd: string, option: string): string {
  let absolutePath: string;
  try {
    absolutePath = host.absolute(cwd, option);
  } catch (error) {
    throw createError("NOT_FOUND", errorMessage(error), cwd);
  }

  const real = callOrThrow(
    () => host.canonical(absolutePath),
    "NOT_FOUND",
    "Could not resolve the project root.",
    absolutePath,
  );

  let entryKind: string | undefined;
  try {
    entryKind = host.kind(real);
  } catch {
    entryKind = undefined;
  }

  if (entryKind !== "directory") {
    throw createError(
      "NOT_FOUND",
      "Could not resolve the project root.",
      absolutePath,
    );
  }
  return real;
}

export function relativeInsideRoot(
  host: Host,
  root: string,
  targetPath: string,
): string {
  let rel: string;
  try {
    rel = host.relative(targetPath, root);
  } catch (error) {
    throw createError("VALIDATION_ERROR", errorMessage(error), targetPath);
  }
  if (rel === ".." || rel.startsWith("../")) {
    throw createError(
      "VALIDATION_ERROR",
      "The selected file must be inside the project root.",
      targetPath,
    );
  }
  return rel;
}

function resolveInsideRoot(
  host: Host,
  root: string,
  targetPath: string,
): string {
  let resolved: string;
  try {
    resolved = host.absolute(root, targetPath);
  } catch (error) {
    throw createError("VALIDATION_ERROR", errorMessage(error), targetPath);
  }
  relativeInsideRoot(host, root, resolved);
  return resolved;
}

function resolveExistingFile(
  host: Host,
  root: string,
  targetPath: string,
): string {
  const resolved = resolveInsideRoot(host, root, targetPath);
  const real = callOrThrow(
    () => host.canonical(resolved),
    "NOT_FOUND",
    "Could not find the selected project file.",
    resolved,
  );
  relativeInsideRoot(host, root, real);

  let entryKind: string | undefined;
  try {
    entryKind = host.kind(real);
  } catch {
    entryKind = undefined;
  }
  if (entryKind !== "file") {
    throw createError(
      "NOT_FOUND",
      "The selected path is not a regular file.",
      real,
    );
  }
  return real;
}

export function resolveOutputPath(
  host: Host,
  root: string,
  targetPath: string,
): string {
  const resolved = resolveInsideRoot(host, root, targetPath);
  let parent: string;
  try {
    parent = host.parent(resolved);
  } catch (error) {
    throw createError("NOT_FOUND", errorMessage(error), resolved);
  }

  const realParent = callOrThrow(
    () => host.canonical(parent),
    "NOT_FOUND",
    "The --output-file parent directory does not exist.",
    parent,
  );
  relativeInsideRoot(host, root, realParent);

  let parentKind: string | undefined;
  try {
    parentKind = host.kind(realParent);
  } catch {
    parentKind = undefined;
  }
  if (parentKind !== "directory") {
    throw createError(
      "NOT_FOUND",
      "The --output-file parent is not a directory.",
      parent,
    );
  }

  let entryKind: string;
  try {
    entryKind = host.kind(resolved);
  } catch (error) {
    throw createError("WRITE_ERROR", errorMessage(error), resolved);
  }
  if (entryKind !== "missing" && entryKind !== "file") {
    throw createError(
      "VALIDATION_ERROR",
      "--output-file must target a regular file.",
      resolved,
    );
  }
  return resolved;
}

function readConfigDocument(
  host: Host,
  root: string,
  configPath: string,
): { path: string; doc: unknown } {
  const resolved = resolveExistingFile(host, root, configPath);
  const parseMessage = "Could not parse the automation configuration as JSON.";
  const text = callOrThrow(
    () => host.read(resolved),
    "PARSE_ERROR",
    parseMessage,
    resolved,
  );
  try {
    return { path: resolved, doc: JSON.parse(text) as unknown };
  } catch {
    throw createError("PARSE_ERROR", parseMessage, resolved);
  }
}

export function validateReportPath(
  host: Host,
  root: string,
  targetPath: string,
  flags: AutomationOptions,
): string {
  const out = resolveOutputPath(host, root, targetPath);
  const existing =
    callOrThrow(
      () => host.kind(out),
      "WRITE_ERROR",
      "Could not inspect --output-file.",
      out,
    ) === "file";
  const real = existing
    ? callOrThrow(
        () => host.canonical(out),
        "WRITE_ERROR",
        "Could not resolve --output-file.",
        out,
      )
    : out;

  const configName = flags.config ?? ".bump-version.json";
  try {
    const configPath = resolveInsideRoot(host, root, configName);
    let canonicalConfig: string | undefined;
    try {
      canonicalConfig = host.canonical(configPath);
    } catch {
      canonicalConfig = undefined;
    }
    if (out === configPath || canonicalConfig === real) {
      throw createError(
        "VALIDATION_ERROR",
        "--output-file must be distinct from the configuration file.",
        out,
      );
    }
  } catch (error) {
    if (error instanceof Error && error.name === "BumpVersionError") {
      if (
        (error as { message: string }).message ===
        "--output-file must be distinct from the configuration file."
      ) {
        throw error;
      }
    }
  }

  if (existing) {
    const options: AutomationOptions = { ...flags };
    try {
      const { doc } = readConfigDocument(host, root, configName);
      if (isRecord(doc)) {
        const android = isRecord(doc.android) ? doc.android : undefined;
        const ios = isRecord(doc.ios) ? doc.ios : undefined;
        if (
          options.androidFile === undefined &&
          typeof android?.file === "string" &&
          android.file.length > 0
        ) {
          options.androidFile = android.file;
        }
        if (
          options.androidModule === undefined &&
          typeof android?.module === "string" &&
          android.module.length > 0
        ) {
          options.androidModule = android.module;
        }
        if (
          options.iosProject === undefined &&
          typeof ios?.project === "string" &&
          ios.project.length > 0
        ) {
          options.iosProject = ios.project;
        }
      }
    } catch {
      // A malformed or unreadable config still belongs in a valid report.
    }

    for (const platform of ["android", "ios"] as const) {
      let projectFile: string | undefined;
      try {
        projectFile = findProjectFile(host, root, platform, options);
      } catch {
        projectFile = undefined;
      }
      if (projectFile === real) {
        throw createError(
          "VALIDATION_ERROR",
          "--output-file must be distinct from the project file.",
          out,
        );
      }
    }
  }

  return out;
}

export function writeOutputDocument(
  host: Host,
  root: string,
  targetPath: string,
  document: string,
): void {
  const resolved = resolveOutputPath(host, root, targetPath);
  let staged: string;
  try {
    staged = host.stage(resolved, document);
  } catch (error) {
    throw createError("WRITE_ERROR", errorMessage(error), resolved);
  }
  try {
    host.rename(staged, resolved);
  } catch (renameError) {
    try {
      host.remove(staged);
    } catch (removeError) {
      throw createError("WRITE_ERROR", errorMessage(removeError), resolved);
    }
    throw createError("WRITE_ERROR", errorMessage(renameError), resolved);
  }
}

const CONFIG_SECTIONS: ReadonlyArray<{
  label: "Configuration" | "android" | "ios";
  keys: readonly string[];
}> = [
  {
    label: "Configuration",
    keys: ["schemaVersion", "platform", "appVersion", "android", "ios"],
  },
  {
    label: "android",
    keys: ["file", "module", "versionName", "versionCode"],
  },
  {
    label: "ios",
    keys: [
      "project",
      "target",
      "configuration",
      "allTargets",
      "marketingVersion",
      "buildNumber",
    ],
  },
];

const CONFIG_KEY_MAP: Readonly<Record<string, keyof AutomationOptions>> = {
  file: "androidFile",
  module: "androidModule",
  project: "iosProject",
  target: "iosTarget",
  configuration: "iosConfiguration",
  platform: "platform",
  appVersion: "appVersion",
  versionName: "versionName",
  versionCode: "versionCode",
  allTargets: "allTargets",
  marketingVersion: "marketingVersion",
  buildNumber: "buildNumber",
};

export function loadConfig(
  host: Host,
  root: string,
  flags: AutomationOptions,
): AutomationOptions {
  const configPath = flags.config ?? ".bump-version.json";
  const resolved = resolveInsideRoot(host, root, configPath);
  const opts: AutomationOptions = {};

  let entryKind: string | undefined;
  try {
    entryKind = host.kind(resolved);
  } catch {
    entryKind = undefined;
  }

  if (flags.config !== undefined || entryKind !== "missing") {
    const { path: realPath, doc } = readConfigDocument(host, root, configPath);

    for (const section of CONFIG_SECTIONS) {
      const value =
        section.label === "Configuration"
          ? doc
          : isRecord(doc) && Object.hasOwn(doc, section.label)
            ? doc[section.label]
            : undefined;
      if (value === undefined && section.label !== "Configuration") {
        continue;
      }
      if (!isRecord(value)) {
        throw createError(
          "PARSE_ERROR",
          `${section.label} must be a JSON object.`,
          realPath,
        );
      }

      const unknown = Object.keys(value).filter(
        (key) => !section.keys.includes(key),
      );
      if (unknown.length > 0) {
        throw createError(
          "PARSE_ERROR",
          `${section.label} contains unknown keys: ${unknown.join(", ")}.`,
          realPath,
        );
      }

      for (const [key, fieldValue] of Object.entries(value)) {
        const field =
          section.label === "Configuration" ? key : `${section.label}.${key}`;
        if (key === "schemaVersion") {
          if (fieldValue !== 1) {
            throw createError(
              "PARSE_ERROR",
              "Configuration schemaVersion must be 1.",
              realPath,
            );
          }
          continue;
        }
        if (key === "android" || key === "ios") {
          continue;
        }

        let normalized: string | boolean;
        if (key === "allTargets") {
          if (typeof fieldValue !== "boolean") {
            throw createError(
              "PARSE_ERROR",
              `${field} must be a boolean.`,
              realPath,
            );
          }
          normalized = fieldValue;
        } else if (key === "versionCode" || key === "buildNumber") {
          if (typeof fieldValue === "string") {
            normalized = fieldValue;
          } else if (
            typeof fieldValue === "number" &&
            Number.isSafeInteger(fieldValue)
          ) {
            normalized = String(fieldValue);
          } else {
            throw createError(
              "PARSE_ERROR",
              `${field} must be an integer or an integer string.`,
              realPath,
            );
          }
        } else {
          if (typeof fieldValue !== "string" || fieldValue.length === 0) {
            throw createError(
              "PARSE_ERROR",
              `${field} must be a non-empty string.`,
              realPath,
            );
          }
          normalized = fieldValue;
        }

        if (
          key === "platform" &&
          normalized !== "android" &&
          normalized !== "ios" &&
          normalized !== "all"
        ) {
          throw createError(
            "PARSE_ERROR",
            "Configuration platform must be android, ios or all.",
            realPath,
          );
        }

        const mappedKey = CONFIG_KEY_MAP[key];
        if (mappedKey !== undefined) {
          (opts as Record<string, unknown>)[mappedKey] = normalized;
        }
      }
    }
  }

  for (const [key, value] of Object.entries(flags)) {
    if (value !== undefined) {
      (opts as Record<string, unknown>)[key] = value;
    }
  }

  return opts;
}

export function findProjectFile(
  host: Host,
  root: string,
  platform: Platform,
  options: AutomationOptions,
): string {
  if (platform === "android") {
    if (options.androidFile !== undefined) {
      return resolveExistingFile(host, root, options.androidFile);
    }
    const moduleName = options.androidModule ?? "app";
    for (const fileName of ["build.gradle.kts", "build.gradle"]) {
      const candidate = resolveInsideRoot(
        host,
        root,
        `android/${moduleName}/${fileName}`,
      );
      let entryKind: string | undefined;
      try {
        entryKind = host.kind(candidate);
      } catch {
        entryKind = undefined;
      }
      if (entryKind !== "missing") {
        return resolveExistingFile(host, root, candidate);
      }
    }
    throw createError(
      "NOT_FOUND",
      `Could not find build.gradle.kts or build.gradle for Android module ${moduleName}.`,
      resolveInsideRoot(host, root, `android/${moduleName}`),
    );
  }

  if (options.iosProject !== undefined) {
    const project = options.iosProject;
    let candidate: string;
    if (project.endsWith("project.pbxproj")) {
      candidate = project;
    } else if (project.endsWith(".xcodeproj")) {
      const hasSeparator = project.includes("/") || project.includes("\\");
      candidate = `${hasSeparator ? "" : "ios/"}${project}/project.pbxproj`;
    } else if (project.includes("/") || project.includes("\\")) {
      candidate = project;
    } else {
      candidate = `ios/${project}.xcodeproj/project.pbxproj`;
    }
    return resolveExistingFile(host, root, candidate);
  }

  const dir = resolveInsideRoot(host, root, "ios");
  const realDir = callOrThrow(
    () => host.canonical(dir),
    "NOT_FOUND",
    "Could not inspect the iOS directory.",
    dir,
  );
  relativeInsideRoot(host, root, realDir);

  const directories = callOrThrow(
    () => host.directories(realDir),
    "NOT_FOUND",
    "Could not inspect the iOS directory.",
    realDir,
  )
    .filter((name) => name.endsWith(".xcodeproj"))
    .sort();

  if (directories.length === 0) {
    throw createError("NOT_FOUND", "No iOS .xcodeproj was found.", dir);
  }
  if (directories.length > 1) {
    throw createError(
      "AMBIGUOUS",
      `Multiple iOS projects were found: ${directories.join(", ")}. Use --ios-project.`,
      dir,
    );
  }
  return resolveExistingFile(
    host,
    root,
    `ios/${directories[0]!}/project.pbxproj`,
  );
}
