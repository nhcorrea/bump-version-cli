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
  const versionWithColor = `${COLORS.BRIGHT}v${version}${COLORS.RESET}`;

  console.log(`${prettyLogWithColor}${versionWithColor}`);
  console.log("\n\n");
  console.log(
    `${COLORS.CYAN}created by:${COLORS.RESET} ${COLORS.YELLOW}@nhcorrea${COLORS.RESET} (https://github.com/nhcorrea)`
  );
}

const program = new Command();

program
  .version(`@nhcorrea/bump-version-cli\nv${version}`)
  .description("CLI to manage project versions");

program.command("android-version").action(() => {
  const androidBuildGradle = readAndroidBuildGradle();

  if (!androidBuildGradle) {
    console.error(
      "Error reading build.gradle. Make sure you are in the correct directory."
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
      "Error reading the project.pbxproj file. Make sure you are in the correct directory."
    );
    return;
  }

  console.clear();
  headerCLI();
  initIOSLogs(iosConfig);
});

program
  .command("android")
  .description("Updates the Android app version")
  .option("-v, --version", "Displays the current Android version")
  .action(() => {
    const androidConfig = readAndroidBuildGradle();

    if (!androidConfig) {
      console.error(
        "Error reading build.gradle. Make sure you are in the correct directory."
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
      `Enter the new Version Code (Build Version) (current: ${androidConfig.buildVersion}):`
    );
    const newVersionNameQuestion = baseColor(
      `Enter the new Version Name (Marketing Version) (current: ${androidConfig.marketingVersion}):`
    );

    rl.question(newVersionNameQuestion, (newVersionName) => {
      if (!newVersionName) {
        console.error(
          "\nThe Android version must follow the semantic versioning pattern (x.x.x)"
        );
        rl.close();
        return;
      }

      if (!VERSION_SEMANTIC_REGEX.test(newVersionName)) {
        console.error(
          "\nThe Android version must follow the semantic versioning format (x.x.x)"
        );
        rl.close();
        return;
      }

      rl.question(newCodeVersionQuestion, (newVersionCode) => {
        if (!newVersionCode) {
          console.error(
            "\nYou must enter a value for the Version Code (Build Version)"
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
            "\nThe Version Code (Build Version) must be a positive integer"
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
      "Error reading the project.pbxproj file. Make sure you are in the correct directory."
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
    "Enter the MARKETING_VERSION (Marketing Version):"
  );
  const newProjectVersionQuestion = baseColor(
    "Enter the CURRENT_PROJECT_VERSION (Build Version):"
  );

  rl.question(newMarketingVersionQuestion, (newMarketingVersion) => {
    if (!newMarketingVersion) {
      console.error(
        "\nYou must enter a value for the Version Name (Marketing Version)"
      );
      rl.close();
      return;
    }

    if (!VERSION_SEMANTIC_REGEX.test(newMarketingVersion)) {
      console.error(
        "\nThe Android version must follow the semantic versioning pattern (x.x.x)"
      );
      rl.close();
      return;
    }

    rl.question(newProjectVersionQuestion, (newProjectVersion) => {
      if (!newProjectVersion) {
        console.error(
          "\nYou must enter a value for the Version Code (Build Version)"
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
          "\nThe Version Code (Build Version) must be a positive integer"
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
