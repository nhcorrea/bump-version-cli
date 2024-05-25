import * as readline from "readline";
import figlet from "figlet";
import { Command } from "commander";
import { colors } from "./src/theme/colors";
import {
  initAndroidLogs,
  readAndroidBuildGradle,
  statusAndroidVersion,
  writeNewAndroidBuildGradle,
} from "./src/lib/android";
import {
  initIOSLogs,
  readIOSConfig,
  statusIOSVersion,
  writeNewIOSVersion,
} from "./src/lib/ios";

export function headerCLI() {
  const prettyLog = figlet.textSync("bump-version", {
    font: "Ogre",
    horizontalLayout: "full",
    verticalLayout: "default",
  });

  const prettyLogWithColor = `${colors.yellow}${prettyLog}${colors.reset}`;
  const versionWithColor = `${colors.bright}v0.0.1${colors.reset}`;

  console.log(`${prettyLogWithColor}${versionWithColor}`);
  console.log("\n\n");
  console.log(
    `${colors.cyan}created by:${colors.reset} ${colors.yellow}@nhcorrea${colors.reset} (https://github.com/nhcorrea)`
  );
}

const program = new Command();

program
  .version("@nhcorrea/bump-version-cli\nv0.0.1")
  .description("CLI para gerenciar versões do projeto");

program.command("android-version").action(() => {
  const androidBuildGradle = readAndroidBuildGradle();

  if (!androidBuildGradle) {
    console.error(
      "Erro ao ler build.gradle. Certifique-se de estar no diretório correto."
    );
    return;
  }

  console.clear();
  headerCLI();
  initAndroidLogs(androidBuildGradle);
});

program.command("ios-version <projectName>").action((projectName) => {
  const iosConfig = readIOSConfig(projectName);

  if (!iosConfig) {
    console.error(
      "Erro ao ler o arquivo project.pbxproj. Certifique-se de estar no diretório correto."
    );
    return;
  }

  console.clear();
  headerCLI();
  initIOSLogs(iosConfig);
});

program
  .command("android")
  .description("Atualiza a versão do aplicativo Android")
  .option("-v, --version", "Exibe a versão atual do Android")
  .action(() => {
    const androidConfig = readAndroidBuildGradle();

    if (!androidConfig) {
      console.error(
        "Erro ao ler build.gradle. Certifique-se de estar no diretório correto."
      );
      return;
    }

    console.clear();
    headerCLI();
    initAndroidLogs(androidConfig);

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const baseColor = (text: string) =>
      `${colors.bgWhite}${colors.black}${text}${colors.reset} `;

    const newCodeVersionQuestion = baseColor(
      `Digite o novo Version Code (Build Version) (atual: ${androidConfig.buildVersion}):`
    );
    const newVersionNameQuestion = baseColor(
      `Digite o novo Version Name (Marketing Version) (atual: ${androidConfig.marketingVersion}):`
    );

    rl.question(newVersionNameQuestion, (newVersionName) => {
      rl.question(newCodeVersionQuestion, (newVersionCode) => {
        writeNewAndroidBuildGradle(newVersionCode, newVersionName);
        const _androidConfig = readAndroidBuildGradle();

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
  headerCLI();
  initIOSLogs(iosConfig);

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

          const _iosConfig = readIOSConfig(projectName);

          if (_iosConfig) {
            const isFinish = true;
            console.log("\n");
            statusIOSVersion(_iosConfig, isFinish);
            console.log("\n");
          }

          rl.close();
        }
      );
    }
  );
});

program.parse(process.argv);
