import * as fs from "fs";

import { AndroidConfig } from "../types/types";
import { ANDROID_BUILD_GRADLE, ANDROID_ENCODE_OPTIONS } from "../config/config";
import { COLORS } from "../theme/colors";
import { BumpVersionError } from "./errors";

export function parseAndroidBuildGradle(file: string): AndroidConfig {
  const buildVersionMatch = file.match(
    /versionCode(?:[ \t]*=[ \t]*|[ \t]+)(\d+)/
  );
  const marketingVersionMatch = file.match(
    /versionName(?:[ \t]*=[ \t]*|[ \t]+)(["'])([^"'\r\n]+)\1/
  );

  if (!buildVersionMatch || !marketingVersionMatch) {
    throw new BumpVersionError(
      "PARSE_ERROR",
      "Could not find both versionCode and versionName assignments.",
      ANDROID_BUILD_GRADLE
    );
  }

  return {
    buildVersion: buildVersionMatch[1],
    marketingVersion: marketingVersionMatch[2],
  };
}

function readAndroidFile(): string {
  try {
    return fs.readFileSync(ANDROID_BUILD_GRADLE, ANDROID_ENCODE_OPTIONS);
  } catch (error) {
    const code =
      error instanceof Error && "code" in error && error.code === "ENOENT"
        ? "NOT_FOUND"
        : "PARSE_ERROR";

    throw new BumpVersionError(
      code,
      "Could not read the Android build.gradle file.",
      ANDROID_BUILD_GRADLE,
      error
    );
  }
}

export function readAndroidBuildGradle(): AndroidConfig {
  return parseAndroidBuildGradle(readAndroidFile());
}

export function transformAndroidBuildGradle(
  file: string,
  newVersionCode: string,
  newVersionName: string
): string {
  let buildMatches = 0;
  let marketingMatches = 0;

  const withBuildVersion = file.replace(
    /(versionCode(?:[ \t]*=[ \t]*|[ \t]+))\d+/g,
    (_match, prefix: string) => {
      buildMatches += 1;
      return `${prefix}${newVersionCode}`;
    }
  );

  const transformed = withBuildVersion.replace(
    /(versionName(?:[ \t]*=[ \t]*|[ \t]+))(["'])[^"'\r\n]*\2/g,
    (_match, prefix: string, quote: string) => {
      marketingMatches += 1;
      return `${prefix}${quote}${newVersionName}${quote}`;
    }
  );

  if (buildMatches === 0 || marketingMatches === 0) {
    throw new BumpVersionError(
      "PARSE_ERROR",
      "No complete Android version assignment was found to update.",
      ANDROID_BUILD_GRADLE
    );
  }

  const result = parseAndroidBuildGradle(transformed);

  if (
    result.buildVersion !== newVersionCode ||
    result.marketingVersion !== newVersionName
  ) {
    throw new BumpVersionError(
      "VERIFY_ERROR",
      "The transformed Android version does not match the requested values.",
      ANDROID_BUILD_GRADLE
    );
  }

  return transformed;
}

export function writeNewAndroidBuildGradle(
  newVersionCode: string,
  newVersionName: string
): AndroidConfig {
  const file = readAndroidFile();
  const transformed = transformAndroidBuildGradle(
    file,
    newVersionCode,
    newVersionName
  );

  try {
    fs.writeFileSync(
      ANDROID_BUILD_GRADLE,
      transformed,
      ANDROID_ENCODE_OPTIONS
    );
  } catch (error) {
    throw new BumpVersionError(
      "WRITE_ERROR",
      "Could not write the Android build.gradle file.",
      ANDROID_BUILD_GRADLE,
      error
    );
  }

  let verified: AndroidConfig;

  try {
    verified = parseAndroidBuildGradle(readAndroidFile());
  } catch (error) {
    throw new BumpVersionError(
      "VERIFY_ERROR",
      "Could not verify the Android version after writing.",
      ANDROID_BUILD_GRADLE,
      error
    );
  }

  if (
    verified.buildVersion !== newVersionCode ||
    verified.marketingVersion !== newVersionName
  ) {
    throw new BumpVersionError(
      "VERIFY_ERROR",
      "The Android file was written, but its final values do not match.",
      ANDROID_BUILD_GRADLE
    );
  }

  return verified;
}

export function statusAndroidVersion(
  androidConfig: AndroidConfig,
  isFinish = false
) {
  const brightText = (text: string) =>
    `${COLORS.BLACK}${COLORS.BG_WHITE}${text}${COLORS.RESET}`;

  const versionCodeStatus = brightText("Version Code (Build):");
  const versionNameStatus = brightText("Version Name (Marketing Version):");

  const versionCode = `${COLORS.BLACK}${COLORS.BG_CYAN}  ${androidConfig.buildVersion} ${COLORS.RESET}`;
  const versionName = `${COLORS.BLACK}${COLORS.BG_CYAN}  ${androidConfig.marketingVersion} ${COLORS.RESET}`;

  const headerText = isFinish
    ? "Android version updated successfully!"
    : "Current Android version:";

  console.log(`\n${COLORS.BLACK}${COLORS.BG_CYAN}${headerText}${COLORS.RESET}`);

  console.log(`${versionNameStatus}${versionName}`);
  console.log(`${versionCodeStatus}${versionCode}`);
}

export function initAndroidLogs(androidConfig: AndroidConfig) {
  console.log("\n");
  statusAndroidVersion(androidConfig);
  console.log("\n\n");
}
