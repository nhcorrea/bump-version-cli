import * as fs from "fs";
import { IOSConfig } from "../types/types";
import { IOS_PROJECT_PATH, IOS_PBXPROJ_PATH } from "../config/config";
import { colors } from "../theme/colors";

export function readIOSConfig(projectName: string): IOSConfig | null {
  try {
    const PROJECT_PATH = `${IOS_PROJECT_PATH}/${projectName}${IOS_PBXPROJ_PATH}`;
    const file = fs.readFileSync(PROJECT_PATH, "utf8");

    const buildVersion = file.match(/CURRENT_PROJECT_VERSION = (\S+)/);
    const marketingVersion = file.match(/MARKETING_VERSION = (\S+);/);

    const currentBuildVersion = buildVersion ? buildVersion[1] : null;
    const currentMarketingVersion = marketingVersion
      ? marketingVersion[1]
      : null;

    return {
      CURRENT_PROJECT_VERSION: currentBuildVersion,
      MARKETING_VERSION: currentMarketingVersion,
    };
  } catch (e) {
    console.error("Erro ao ler o arquivo project.pbxproj:", e);
    return null;
  }
}

export function writeNewIOSVersion(
  projectName: string,
  newBuildVersion: string,
  newMarketingVersion: string
) {
  try {
    const FILE_PATH = `${IOS_PROJECT_PATH}/${projectName}.xcodeproj/project.pbxproj`;
    let file = fs.readFileSync(FILE_PATH, "utf8");

    file = file.replace(
      /CURRENT_PROJECT_VERSION = (\S+)/g,
      `CURRENT_PROJECT_VERSION = ${newBuildVersion}`
    );
    file = file.replace(
      /MARKETING_VERSION = (\d+\.\d+\.\d+);/g,
      `MARKETING_VERSION = ${newMarketingVersion};`
    );

    fs.writeFileSync(FILE_PATH, file, "utf8");
  } catch (e) {
    console.error("Erro ao atualizar a versão do iOS:", e);
  }
}

export function statusIOSVersion(iosConfig: IOSConfig, isFinish = false) {
  const brightText = (text: string) =>
    `${colors.black}${colors.bgWhite}${text}${colors.reset}`;

  const buildVersionStatus = brightText("Current Project Version (Build):");
  const marketingVersionStatus = brightText(
    "Marketing Version (Marketing Version):"
  );

  const versionCode = `${colors.black}${colors.bgCyan}  ${iosConfig.CURRENT_PROJECT_VERSION} ${colors.reset}`;
  const versionName = `${colors.black}${colors.bgCyan}  ${iosConfig.MARKETING_VERSION} ${colors.reset}`;

  const headerText = isFinish
    ? "Versão do Android atualizada com sucesso!"
    : "Versão atual do App iOS:";

  console.log(`\n${colors.black}${colors.bgCyan}${headerText}${colors.reset}`);
  console.log(`${buildVersionStatus}${versionName}`);
  console.log(`${marketingVersionStatus}${versionCode}`);
}

export function initIOSLogs(IOSConfig: IOSConfig) {
  console.log("\n");
  statusIOSVersion(IOSConfig);
  console.log("\n\n");
}
