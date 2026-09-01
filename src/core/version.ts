import { BumpVersionError } from "../lib/errors";

export const MAX_ANDROID_VERSION_CODE = 2_100_000_000;

const SEMANTIC_VERSION_REGEX = /^\d+\.\d+\.\d+$/;

export function validateSemanticVersion(
  value: string,
  platform: "Android" | "iOS"
): string {
  if (!SEMANTIC_VERSION_REGEX.test(value)) {
    throw new BumpVersionError(
      "VALIDATION_ERROR",
      `The ${platform} marketing version must follow x.x.x.`,
      "marketingVersion"
    );
  }

  return value;
}

export function validatePositiveBuildVersion(
  value: string,
  field = "buildVersion"
): string {
  if (!/^\d+$/.test(value)) {
    throw new BumpVersionError(
      "VALIDATION_ERROR",
      "The build version must be a positive integer.",
      field
    );
  }

  const numericValue = Number(value);

  if (!Number.isSafeInteger(numericValue) || numericValue <= 0) {
    throw new BumpVersionError(
      "VALIDATION_ERROR",
      "The build version must be a positive integer.",
      field
    );
  }

  return String(numericValue);
}

export function validateAndroidVersionCode(
  value: string,
  currentValue?: string,
  allowDowngrade = false
): string {
  const normalizedValue = validatePositiveBuildVersion(value, "versionCode");
  const numericValue = Number(normalizedValue);

  if (numericValue > MAX_ANDROID_VERSION_CODE) {
    throw new BumpVersionError(
      "VALIDATION_ERROR",
      `Android versionCode must be at most ${MAX_ANDROID_VERSION_CODE}.`,
      "versionCode"
    );
  }

  if (currentValue !== undefined) {
    const normalizedCurrentValue = validatePositiveBuildVersion(
      currentValue,
      "currentVersionCode"
    );
    const numericCurrentValue = Number(normalizedCurrentValue);

    if (!allowDowngrade && numericValue < numericCurrentValue) {
      throw new BumpVersionError(
        "VERSION_CONFLICT",
        `Android versionCode cannot decrease from ${normalizedCurrentValue} to ${normalizedValue} without --allow-downgrade.`,
        "versionCode"
      );
    }
  }

  return normalizedValue;
}
