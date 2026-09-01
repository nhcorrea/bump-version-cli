import * as fs from "fs";
import { resolve } from "path";
import type { AutomationOptions } from "./automation";
import { resolveConfinedFile } from "./paths";
import { BumpVersionError } from "../lib/errors";

type JsonObject = Record<string, unknown>;

const TOP_LEVEL_KEYS = new Set([
  "schemaVersion",
  "platform",
  "appVersion",
  "android",
  "ios",
]);
const ANDROID_KEYS = new Set([
  "file",
  "module",
  "versionName",
  "versionCode",
]);
const IOS_KEYS = new Set([
  "project",
  "target",
  "configuration",
  "allTargets",
  "marketingVersion",
  "buildNumber",
]);

function assertObject(
  value: unknown,
  label: string,
  path: string
): asserts value is JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new BumpVersionError(
      "PARSE_ERROR",
      `${label} must be a JSON object.`,
      path
    );
  }
}

function assertKnownKeys(
  value: JsonObject,
  keys: Set<string>,
  label: string,
  path: string
): void {
  const unknown = Object.keys(value).filter((key) => !keys.has(key));

  if (unknown.length > 0) {
    throw new BumpVersionError(
      "PARSE_ERROR",
      `${label} contains unknown keys: ${unknown.join(", ")}.`,
      path
    );
  }
}

function optionalString(
  value: unknown,
  label: string,
  path: string
): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string" || value === "") {
    throw new BumpVersionError(
      "PARSE_ERROR",
      `${label} must be a non-empty string.`,
      path
    );
  }

  return value;
}

function optionalIntegerString(
  value: unknown,
  label: string,
  path: string
): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (
    (typeof value !== "string" && typeof value !== "number") ||
    (typeof value === "number" && !Number.isSafeInteger(value))
  ) {
    throw new BumpVersionError(
      "PARSE_ERROR",
      `${label} must be an integer or an integer string.`,
      path
    );
  }

  return String(value);
}

function optionalBoolean(
  value: unknown,
  label: string,
  path: string
): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "boolean") {
    throw new BumpVersionError(
      "PARSE_ERROR",
      `${label} must be a boolean.`,
      path
    );
  }

  return value;
}

function parseConfig(document: unknown, path: string): AutomationOptions {
  assertObject(document, "Configuration", path);
  assertKnownKeys(document, TOP_LEVEL_KEYS, "Configuration", path);

  if (document.schemaVersion !== undefined && document.schemaVersion !== 1) {
    throw new BumpVersionError(
      "PARSE_ERROR",
      "Configuration schemaVersion must be 1.",
      path
    );
  }

  const platform = optionalString(document.platform, "platform", path);

  if (
    platform !== undefined &&
    platform !== "android" &&
    platform !== "ios" &&
    platform !== "all"
  ) {
    throw new BumpVersionError(
      "PARSE_ERROR",
      "Configuration platform must be android, ios or all.",
      path
    );
  }

  let android: JsonObject = {};
  let ios: JsonObject = {};

  if (document.android !== undefined) {
    assertObject(document.android, "android", path);
    assertKnownKeys(document.android, ANDROID_KEYS, "android", path);
    android = document.android;
  }

  if (document.ios !== undefined) {
    assertObject(document.ios, "ios", path);
    assertKnownKeys(document.ios, IOS_KEYS, "ios", path);
    ios = document.ios;
  }

  return {
    platform,
    appVersion: optionalString(document.appVersion, "appVersion", path),
    androidFile: optionalString(android.file, "android.file", path),
    androidModule: optionalString(android.module, "android.module", path),
    versionName: optionalString(android.versionName, "android.versionName", path),
    versionCode: optionalIntegerString(
      android.versionCode,
      "android.versionCode",
      path
    ),
    iosProject: optionalString(ios.project, "ios.project", path),
    iosTarget: optionalString(ios.target, "ios.target", path),
    iosConfiguration: optionalString(
      ios.configuration,
      "ios.configuration",
      path
    ),
    allTargets: optionalBoolean(ios.allTargets, "ios.allTargets", path),
    marketingVersion: optionalString(
      ios.marketingVersion,
      "ios.marketingVersion",
      path
    ),
    buildNumber: optionalIntegerString(
      ios.buildNumber,
      "ios.buildNumber",
      path
    ),
  };
}

export function loadAutomationConfig(
  root: string,
  configOption?: string
): AutomationOptions {
  const defaultPath = resolve(root, ".bump-version.json");

  if (!configOption && !fs.existsSync(defaultPath)) {
    return {};
  }

  const path = resolveConfinedFile(root, configOption ?? ".bump-version.json");
  let document: unknown;

  try {
    document = JSON.parse(fs.readFileSync(path, "utf8"));
  } catch (error) {
    throw new BumpVersionError(
      "PARSE_ERROR",
      "Could not parse the automation configuration as JSON.",
      path,
      error
    );
  }

  return parseConfig(document, path);
}

export function mergeAutomationOptions(
  config: AutomationOptions,
  flags: AutomationOptions
): AutomationOptions {
  const definedFlags = Object.fromEntries(
    Object.entries(flags).filter(([, value]) => value !== undefined)
  );

  return { ...config, ...definedFlags };
}
