import * as fs from "fs";

import { AndroidConfig } from "../types/types";
import { ANDROID_BUILD_GRADLE, ANDROID_ENCODE_OPTIONS } from "../config/config";
import { COLORS } from "../theme/colors";

export function readAndroidBuildGradle(): AndroidConfig | null {
  try {
    const file = fs.readFileSync(ANDROID_BUILD_GRADLE, ANDROID_ENCODE_OPTIONS);

    const buildVersionMatch = file.match(/versionCode\s+(\d+)/);
    const marketingVersionMatch = file.match(/versionName\s+"([^"]+)"/);

    const buildVersion = buildVersionMatch ? buildVersionMatch[1] : null;
    const marketingVersion = marketingVersionMatch
      ? marketingVersionMatch[1]
      : null;

    return {
      buildVersion,
      marketingVersion,
    };
  } catch (e) {
    console.error("Erro ao ler build.gradle", e);
    return null;
  }
}

export function writeNewAndroidBuildGradle(
  newVersionCode: string,
  newVersionName: string
) {
  try {
    let file = fs.readFileSync(ANDROID_BUILD_GRADLE, ANDROID_ENCODE_OPTIONS);

    file = file.replace(/versionCode\s+\d+/g, `versionCode ${newVersionCode}`);
    file = file.replace(
      /versionName\s+"[^"]+"/g,
      `versionName "${newVersionName}"`
    );

    fs.writeFileSync(ANDROID_BUILD_GRADLE, file, ANDROID_ENCODE_OPTIONS);
  } catch (e) {
    console.error("Erro ao atualizar a versão do Android:", e);
  }
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
    ? "Versão do Android atualizada com sucesso!"
    : "Versão atual do Android:";

  console.log(`\n${COLORS.BLACK}${COLORS.BG_CYAN}${headerText}${COLORS.RESET}`);

  console.log(`${versionNameStatus}${versionName}`);
  console.log(`${versionCodeStatus}${versionCode}`);
}

export function initAndroidLogs(androidConfig: AndroidConfig) {
  console.log("\n");
  statusAndroidVersion(androidConfig);
  console.log("\n\n");
}
