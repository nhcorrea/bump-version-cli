#!/usr/bin/env node
import * as readline from "readline";
import figlet from "figlet";
import { Command } from "commander";
import { version } from "./package.json";
import { COLORS } from "./src/theme/colors";
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

const baseColor = (text: string) =>
  `${COLORS.BG_WHITE}${COLORS.BLACK}${text}${COLORS.RESET} `;

const VERSION_SEMANTIC_REGEX = /^\d+\.\d+\.\d+$/;

export function headerCLI() {
  const prettyLog = figlet.textSync("bump-version", {
    font: "Ogre",
    horizontalLayout: "full",
    verticalLayout: "default",
  });

  const prettyLogWithColor = `${COLORS.YELLOW}${prettyLog}${COLORS.RESET}`;
  const versionWithColor = `${COLORS.BRIGHT}${version}${COLORS.RESET}`;

  console.log(`${prettyLogWithColor}${versionWithColor}`);
  console.log("\n\n");
  console.log(
    `${COLORS.CYAN}created by:${COLORS.RESET} ${COLORS.YELLOW}@nhcorrea${COLORS.RESET} (https://github.com/nhcorrea)`
  );
}

const program = new Command();

program
  .version(`@nhcorrea/bump-version-cli\nv${version}`)
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

    const newCodeVersionQuestion = baseColor(
      `Digite o novo Version Code (Build Version) (atual: ${androidConfig.buildVersion}):`
    );
    const newVersionNameQuestion = baseColor(
      `Digite o novo Version Name (Marketing Version) (atual: ${androidConfig.marketingVersion}):`
    );

    rl.question(newVersionNameQuestion, (newVersionName) => {
      if (!newVersionName) {
        console.error(
          "\nVocê deve inserir um valor para o Version Name (Marketing Version)"
        );

        rl.close();
        return;
      }

      if (!VERSION_SEMANTIC_REGEX.test(newVersionName)) {
        console.error(
          "\nA versão do Android deve seguir o padrão semântico (x.x.x)"
        );
        rl.close();
        return;
      }

      rl.question(newCodeVersionQuestion, (newVersionCode) => {
        if (!newVersionCode) {
          console.error(
            "\nVocê deve inserir um valor para o Version Code (Build Version)"
          );
          rl.close();
          return;
        }

        const versionCode = Number(newVersionCode);

        if (
          isNaN(versionCode) ||
          versionCode < 0 ||
          !Number.isInteger(versionCode)
        ) {
          console.error(
            "\nO Version Code (Build Version) deve ser um número inteiro positivo"
          );

          rl.close();
          return;
        }

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

  const newMarketingVersionQuestion = baseColor(
    "Digite o MARKETING_VERSION (Marketing Version):"
  );
  const newProjectVersionQuestion = baseColor(
    "Digite o CURRENT_PROJECT_VERSION (Build Version):"
  );

  rl.question(newMarketingVersionQuestion, (newMarketingVersion) => {
    if (!newMarketingVersion) {
      console.error(
        "\nVocê deve inserir um valor para o Version Name (Marketing Version)"
      );

      rl.close();
      return;
    }

    if (!VERSION_SEMANTIC_REGEX.test(newMarketingVersion)) {
      console.error(
        "\nA versão do Android deve seguir o padrão semântico (x.x.x)"
      );
      rl.close();
      return;
    }

    rl.question(newProjectVersionQuestion, (newProjectVersion) => {
      if (!newProjectVersion) {
        console.error(
          "\nVocê deve inserir um valor para o Version Code (Build Version)"
        );
        rl.close();
        return;
      }

      const versionCode = Number(newProjectVersion);

      if (
        isNaN(versionCode) ||
        versionCode < 0 ||
        !Number.isInteger(versionCode)
      ) {
        console.error(
          "\nO Version Code (Build Version) deve ser um número inteiro positivo"
        );

        rl.close();
        return;
      }

      writeNewIOSVersion(projectName, newProjectVersion, newMarketingVersion);

      const _iosConfig = readIOSConfig(projectName);

      if (_iosConfig) {
        const isFinish = true;
        console.log("\n");
        statusIOSVersion(_iosConfig, isFinish);
        console.log("\n");
      }

      rl.close();
    });
  });
});

program.parse(process.argv);
