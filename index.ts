import * as readline from "readline";
import * as fs from "fs";
import { Command } from "commander";
import figlet from "figlet";

type AndroidConfigFS =
  | {
      encoding: BufferEncoding;
      flag?: string | undefined;
    }
  | BufferEncoding;

interface AndroidConfig {
  versionCode: string | null;
  versionName: string | null;
}

type IOSConfig = {
  CURRENT_PROJECT_VERSION: string | null;
  MARKETING_VERSION: string | null;
};

const IOS_PROJECT_PATH = "./ios";
const IOS_REST_PATH = ".xcodeproj/project.pbxproj";

function readIOSConfig(projectName: string): IOSConfig | null {
  try {
    const projectFilePath = `${IOS_PROJECT_PATH}/${projectName}${IOS_REST_PATH}`;
    const projectFile = fs.readFileSync(projectFilePath, "utf8");

    const currentProjectVersionMatch = projectFile.match(
      /CURRENT_PROJECT_VERSION = (\S+)/
    );
    const marketingVersionMatch = projectFile.match(
      /MARKETING_VERSION = "([^"]+)"/
    );

    const currentProjectVersion = currentProjectVersionMatch
      ? currentProjectVersionMatch[1]
      : null;
    const marketingVersion = marketingVersionMatch
      ? marketingVersionMatch[1]
      : null;

    return {
      CURRENT_PROJECT_VERSION: currentProjectVersion,
      MARKETING_VERSION: marketingVersion,
    };
  } catch (e) {
    console.error("Erro ao ler o arquivo project.pbxproj:", e);
    return null;
  }
}

function writeNewIOSVersion(
  projectName: string,
  newProjectVersion: string,
  newMarketingVersion: string
) {
  try {
    const projectFilePath = `${IOS_PROJECT_PATH}/${projectName}.xcodeproj/project.pbxproj`;

    let projectFile = fs.readFileSync(projectFilePath, "utf8");

    projectFile = projectFile.replace(
      /CURRENT_PROJECT_VERSION = (\S+)/g,
      `CURRENT_PROJECT_VERSION = ${newProjectVersion}`
    );
    projectFile = projectFile.replace(
      /MARKETING_VERSION = (\d+\.\d+\.\d+);/g,
      `MARKETING_VERSION = ${newMarketingVersion};`
    );

    fs.writeFileSync(projectFilePath, projectFile, "utf8");
  } catch (e) {
    console.error("Erro ao atualizar a versão do iOS:", e);
  }
}

const ANDROID_BUILD_GRADLE = "./android/app/build.gradle";
const ANDROID_ENCODE_OPTIONS: AndroidConfigFS = "utf8";

function readAndroidConfig(): AndroidConfig | null {
  try {
    const buildGradleFile = fs.readFileSync(
      ANDROID_BUILD_GRADLE,
      ANDROID_ENCODE_OPTIONS
    );

    const versionCodeMatch = buildGradleFile.match(/versionCode\s+(\d+)/);
    const versionNameMatch = buildGradleFile.match(/versionName\s+"([^"]+)"/);

    const versionCode = versionCodeMatch ? versionCodeMatch[1] : null;
    const versionName = versionNameMatch ? versionNameMatch[1] : null;

    return {
      versionCode,
      versionName,
    };
  } catch (e) {
    console.error("Erro ao ler build.gradle", e);
    return null;
  }
}

function writeNewAndroidVersion(
  newVersionCode: string,
  newVersionName: string
) {
  try {
    let data = fs.readFileSync(ANDROID_BUILD_GRADLE, ANDROID_ENCODE_OPTIONS);

    data = data.replace(/versionCode\s+\d+/g, `versionCode ${newVersionCode}`);
    data = data.replace(
      /versionName\s+"[^"]+"/g,
      `versionName "${newVersionName}"`
    );

    fs.writeFileSync(ANDROID_BUILD_GRADLE, data, ANDROID_ENCODE_OPTIONS);
  } catch (e) {
    console.error("Erro ao atualizar a versão do Android:", e);
  }
}

function headerAndroidCLI() {
  let prettyLog = figlet.textSync("bump-version-cli", {
    font: "Ogre",
    horizontalLayout: "full",
    verticalLayout: "default",
  });

  let prettyLogWithColor = `${colors.green}${prettyLog}${colors.reset}`;
  let versionWithColor = `${colors.bright}v0.0.1${colors.reset}`;

  console.log(`${prettyLogWithColor}${versionWithColor}`);

  console.log("\n\n");

  console.log(
    `${colors.cyan}created by:${colors.reset} ${colors.yellow}@nhcorrea${colors.reset} (https://github.com/nhcorrea)`
  );
}

function statusAndroidVersion(androidConfig: AndroidConfig, isFinish = false) {
  const brightText = (text: string) =>
    `${colors.black}${colors.bgWhite}${text}${colors.reset}`;

  const versionCodeStatus = brightText("Version Code (Build):");
  const versionNameStatus = brightText("Version Name (Marketing Version):");

  const versionCode = `${colors.black}${colors.bgGreen}  ${androidConfig.versionCode} ${colors.reset}`;
  const versionName = `${colors.black}${colors.bgGreen}  ${androidConfig.versionName} ${colors.reset}`;

  const headerText = isFinish
    ? "Versão do Android atualizada com sucesso!"
    : "Versão atual do Android:";

  console.log(`\n${colors.black}${colors.bgGreen}${headerText}${colors.reset}`);

  console.log(`${versionNameStatus}${versionName}`);
  console.log(`${versionCodeStatus}${versionCode}`);
}

function initAndroidLogs(androidConfig: AndroidConfig) {
  console.clear();
  headerAndroidCLI();
  console.log("\n");
  statusAndroidVersion(androidConfig);
  console.log("\n\n");
}

const program = new Command();

const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  black: "\x1b[30m",
  green: "\x1b[32m",
  cyan: "\x1b[36m",
  yellow: "\x1b[33m",
  bgBlack: "\x1b[40m",
  bgGreen: "\x1b[42m",
  bgCyan: "\x1b[46m",
  bgWhite: "\x1b[47m",
};

program
  .command("android")
  .description("Atualiza a versão do aplicativo Android")
  .option("-v, --version", "Exibe a versão atual do Android")
  .action(() => {
    const androidConfig = readAndroidConfig();

    if (!androidConfig) {
      console.error(
        "Erro ao ler build.gradle. Certifique-se de estar no diretório correto."
      );
      return;
    }

    initAndroidLogs(androidConfig);

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const baseColor = (text: string) =>
      `${colors.bgGreen}${colors.black}${text}${colors.reset} `;

    const newCodeVersionQuestion = baseColor(
      `Digite o novo Version Code (Build Version) (atual: ${androidConfig.versionCode}):`
    );
    const newVersionNameQuestion = baseColor(
      `Digite o novo Version Name (Marketing Version) (atual: ${androidConfig.versionName}):`
    );

    rl.question(newVersionNameQuestion, (newVersionName) => {
      rl.question(newCodeVersionQuestion, (newVersionCode) => {
        writeNewAndroidVersion(newVersionCode, newVersionName);
        const _androidConfig = readAndroidConfig();

        if (_androidConfig) {
          const isFinish = true;
          console.log("\n");
          statusAndroidVersion(_androidConfig, isFinish);
          console.log("\n");
        }

        rl.close();
      });
    });
  });

program.command("ios <projectName>").action((projectName) => {
  const iosConfig = readIOSConfig(projectName);

  if (!iosConfig) {
    console.error(
      "Erro ao ler o arquivo project.pbxproj. Certifique-se de estar no diretório correto."
    );
    return;
  }

  console.clear();

  const prettyLog = figlet.textSync("bump-version-cli", {
    font: "Ogre",
    horizontalLayout: "full",
    verticalLayout: "default",
  });

  console.log(`${colors.green}${prettyLog}${colors.reset}`);

  console.log("\n\n");

  // console.log(
  //   `${colors.cyan}created by:${colors.reset} ${colors.yellow}@nhcorrea${colors.reset} (
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  rl.question(
    "Digite o MARKETING_VERSION (Marketing Version) ",
    (newMarketingVersion) => {
      rl.question(
        "Digite o CURRENT_PROJECT_VERSION (Build Version) ",
        (newProjectVersion) => {
          writeNewIOSVersion(
            projectName,
            newProjectVersion,
            newMarketingVersion
          );
          // writeNewAndroidVersion(newVersionCode, newVersionName);
          const _iosConfig = readIOSConfig(projectName);

          // if (_iosConfig) {
          //   const isFinish = true;
          //   console.log("\n");
          //   statusAndroidVersion(_androidConfig, isFinish);
          //   console.log("\n");
          // }

          rl.close();
        }
      );
    }
  );
});

program.parse(process.argv);
