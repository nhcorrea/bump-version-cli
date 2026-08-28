import * as fs from "fs";
import { IOSConfig } from "../types/types";
import { IOS_PROJECT_PATH, IOS_PBXPROJ_PATH } from "../config/config";
import { COLORS } from "../theme/colors";
import { BumpVersionError } from "./errors";

function iosProjectPath(projectName: string): string {
  return `${IOS_PROJECT_PATH}/${projectName}${IOS_PBXPROJ_PATH}`;
}

export function parseIOSConfig(file: string, path: string): IOSConfig {
  const buildVersion = file.match(
    /CURRENT_PROJECT_VERSION[ \t]*=[ \t]*([^;\s]+)[ \t]*;/
  );
  const marketingVersion = file.match(
    /MARKETING_VERSION[ \t]*=[ \t]*([^;\s]+)[ \t]*;/
  );

  if (!buildVersion || !marketingVersion) {
    throw new BumpVersionError(
      "PARSE_ERROR",
      "Could not find both iOS version assignments.",
      path
    );
  }

  return {
    CURRENT_PROJECT_VERSION: buildVersion[1],
    MARKETING_VERSION: marketingVersion[1],
  };
}

function readIOSFile(path: string): string {
  try {
    return fs.readFileSync(path, "utf8");
  } catch (error) {
    const code =
      error instanceof Error && "code" in error && error.code === "ENOENT"
        ? "NOT_FOUND"
        : "PARSE_ERROR";

    throw new BumpVersionError(
      code,
      "Could not read the iOS project.pbxproj file.",
      path,
      error
    );
  }
}

export function readIOSConfig(projectName: string): IOSConfig {
  const path = iosProjectPath(projectName);
  return parseIOSConfig(readIOSFile(path), path);
}

export function transformIOSConfig(
  file: string,
  path: string,
  newBuildVersion: string,
  newMarketingVersion: string
): string {
  let buildMatches = 0;
  let marketingMatches = 0;

  const withBuildVersion = file.replace(
    /(CURRENT_PROJECT_VERSION[ \t]*=[ \t]*)[^;\r\n]+?([ \t]*;)/g,
    (_match, prefix: string, terminator: string) => {
      buildMatches += 1;
      return `${prefix}${newBuildVersion}${terminator}`;
    }
  );

  const transformed = withBuildVersion.replace(
    /(MARKETING_VERSION[ \t]*=[ \t]*)[^;\r\n]+?([ \t]*;)/g,
    (_match, prefix: string, terminator: string) => {
      marketingMatches += 1;
      return `${prefix}${newMarketingVersion}${terminator}`;
    }
  );

  if (buildMatches === 0 || marketingMatches === 0) {
    throw new BumpVersionError(
      "PARSE_ERROR",
      "No complete iOS version assignment was found to update.",
      path
    );
  }

  const result = parseIOSConfig(transformed, path);

  if (
    result.CURRENT_PROJECT_VERSION !== newBuildVersion ||
    result.MARKETING_VERSION !== newMarketingVersion
  ) {
    throw new BumpVersionError(
      "VERIFY_ERROR",
      "The transformed iOS version does not match the requested values.",
      path
    );
  }

  return transformed;
}

export function writeNewIOSVersion(
  projectName: string,
  newBuildVersion: string,
  newMarketingVersion: string
): IOSConfig {
  const path = iosProjectPath(projectName);
  const file = readIOSFile(path);
  const transformed = transformIOSConfig(
    file,
    path,
    newBuildVersion,
    newMarketingVersion
  );

  try {
    fs.writeFileSync(path, transformed, "utf8");
  } catch (error) {
    throw new BumpVersionError(
      "WRITE_ERROR",
      "Could not write the iOS project.pbxproj file.",
      path,
      error
    );
  }

  let verified: IOSConfig;

  try {
    verified = parseIOSConfig(readIOSFile(path), path);
  } catch (error) {
    throw new BumpVersionError(
      "VERIFY_ERROR",
      "Could not verify the iOS version after writing.",
      path,
      error
    );
  }

  if (
    verified.CURRENT_PROJECT_VERSION !== newBuildVersion ||
    verified.MARKETING_VERSION !== newMarketingVersion
  ) {
    throw new BumpVersionError(
      "VERIFY_ERROR",
      "The iOS file was written, but its final values do not match.",
      path
    );
  }

  return verified;
}

export function statusIOSVersion(iosConfig: IOSConfig, isFinish = false) {
  const brightText = (text: string) =>
    `${COLORS.BLACK}${COLORS.BG_WHITE}${text}${COLORS.RESET}`;

  const buildVersionStatus = brightText("Current Project Version (Build):");
  const marketingVersionStatus = brightText(
    "Marketing Version (Marketing Version):"
  );

  const versionCode = `${COLORS.BLACK}${COLORS.BG_CYAN}  ${iosConfig.CURRENT_PROJECT_VERSION} ${COLORS.RESET}`;
  const versionName = `${COLORS.BLACK}${COLORS.BG_CYAN}  ${iosConfig.MARKETING_VERSION} ${COLORS.RESET}`;

  const headerText = isFinish
    ? "iOS version updated successfully!"
    : "Current iOS app version:";

  console.log(`\n${COLORS.BLACK}${COLORS.BG_CYAN}${headerText}${COLORS.RESET}`);
  console.log(`${buildVersionStatus}${versionCode}`);
  console.log(`${marketingVersionStatus}${versionName}`);
}

export function initIOSLogs(IOSConfig: IOSConfig) {
  console.log("\n");
  statusIOSVersion(IOSConfig);
  console.log("\n\n");
}
