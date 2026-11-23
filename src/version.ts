import { createError } from "./errors";
import type { Platform, ReleaseType } from "./types";

export const MAX_SAFE_BUILD = 9_007_199_254_740_991;
const MAX_SAFE_BUILD_BIGINT = BigInt(MAX_SAFE_BUILD);
export const MAX_ANDROID_VERSION_CODE = 2_100_000_000;

export function isAsciiDigits(value: string): boolean {
  if (value.length === 0) {
    return false;
  }
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 48 || code > 57) {
      return false;
    }
  }
  return true;
}

export function platformDisplayName(platform: Platform): string {
  return platform === "android" ? "Android" : "iOS";
}

export function validateSemanticVersion(
  value: string,
  platformName: string,
): void {
  const parts = value.split(".");
  if (parts.length !== 3 || !parts.every(isAsciiDigits)) {
    throw createError(
      "VALIDATION_ERROR",
      `The ${platformName} marketing version must follow x.x.x.`,
      "marketingVersion",
    );
  }
}

export function parsePositiveBuild(value: string, field: string): number {
  if (isAsciiDigits(value)) {
    const parsed = BigInt(value);
    if (parsed >= 1n && parsed <= MAX_SAFE_BUILD_BIGINT) {
      return Number(parsed);
    }
  }
  throw createError(
    "VALIDATION_ERROR",
    "The build version must be a positive integer.",
    field,
  );
}

export function validateAndroidVersionCode(
  value: string,
  current: string | undefined,
  allowDowngrade: boolean,
): number {
  const n = parsePositiveBuild(value, "versionCode");
  if (n > MAX_ANDROID_VERSION_CODE) {
    throw createError(
      "VALIDATION_ERROR",
      "Android versionCode must be at most 2100000000.",
      "versionCode",
    );
  }
  if (current !== undefined) {
    const c = parsePositiveBuild(current, "currentVersionCode");
    if (n < c && !allowDowngrade) {
      throw createError(
        "VERSION_CONFLICT",
        `Android versionCode cannot decrease from ${c} to ${n} without --allow-downgrade.`,
        "versionCode",
      );
    }
  }
  return n;
}

export function bumpSemanticVersion(
  value: string,
  release: ReleaseType,
): string {
  const parts = value.split(".").map((segment) => {
    const trimmed = segment.replace(/^0+/, "");
    return trimmed.length === 0 ? "0" : trimmed;
  });
  const index = release === "major" ? 0 : release === "minor" ? 1 : 2;
  parts[index] = (BigInt(parts[index] ?? "0") + 1n).toString();
  for (let i = index + 1; i < parts.length; i += 1) {
    parts[i] = "0";
  }
  return parts.join(".");
}
