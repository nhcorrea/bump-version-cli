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
import { isBumpVersionError } from "./src/lib/errors";

const baseColor = (text: string) =>
  `${COLORS.BG_WHITE}${COLORS.BLACK}${text}${COLORS.RESET} `;

const VERSION_SEMANTIC_REGEX = /^\d+\.\d+\.\d+$/;

const EXIT_CODE = {
  unexpected: 1,
  validation: 2,
  notFound: 3,
  parse: 4,
  write: 6,
} as const;

function handleCommandError(error: unknown) {
  if (isBumpVersionError(error)) {
    const exitCode =
      error.code === "NOT_FOUND"
        ? EXIT_CODE.notFound
        : error.code === "PARSE_ERROR" || error.code === "AMBIGUOUS"
        ? EXIT_CODE.parse
        : EXIT_CODE.write;

    console.error(`${error.code}: ${error.message} (${error.path})`);
    process.exitCode = exitCode;
    return;
  }

  const message = error instanceof Error ? error.message : String(error);
  console.error(`UNEXPECTED_ERROR: ${message}`);
  process.exitCode = EXIT_CODE.unexpected;
}

function failValidation(message: string) {
  console.error(message);
  process.exitCode = EXIT_CODE.validation;
}

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
  try {
    const androidBuildGradle = readAndroidBuildGradle();

    console.clear();
    headerCLI();
    initAndroidLogs(androidBuildGradle);
  } catch (error) {
    handleCommandError(error);
  }
});

program.command("ios-version <projectName>").action((projectName) => {
  try {
    const iosConfig = readIOSConfig(projectName);

    console.clear();
    headerCLI();
    initIOSLogs(iosConfig);
  } catch (error) {
    handleCommandError(error);
  }
});

program
  .command("android")
  .description("Updates the Android app version")
  .option("-v, --version", "Displays the current Android version")
  .action(() => {
    let androidConfig;

    try {
      androidConfig = readAndroidBuildGradle();
    } catch (error) {
      handleCommandError(error);
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
        failValidation(
          "\nThe Android version must follow the semantic versioning pattern (x.x.x)"
        );
        rl.close();
        return;
      }

      if (!VERSION_SEMANTIC_REGEX.test(newVersionName)) {
        failValidation(
          "\nThe Android version must follow the semantic versioning format (x.x.x)"
        );
        rl.close();
        return;
      }

      rl.question(newCodeVersionQuestion, (newVersionCode) => {
        if (!newVersionCode) {
          failValidation(
            "\nYou must enter a value for the Version Code (Build Version)"
          );
          rl.close();
          return;
        }

        const versionCode = Number(newVersionCode);

        if (
          isNaN(versionCode) ||
          versionCode <= 0 ||
          !Number.isInteger(versionCode)
        ) {
          failValidation(
            "\nThe Version Code (Build Version) must be a positive integer"
          );
          rl.close();
          return;
        }

        try {
          const updatedAndroidConfig = writeNewAndroidBuildGradle(
            newVersionCode,
            newVersionName
          );
          const isFinish = true;
          console.log("\n");
          statusAndroidVersion(updatedAndroidConfig, isFinish);
          console.log("\n");
        } catch (error) {
          handleCommandError(error);
        }

        rl.close();
      });
    });
  });

program.command("ios <projectName>").action((projectName) => {
  let iosConfig;

  try {
    iosConfig = readIOSConfig(projectName);
  } catch (error) {
    handleCommandError(error);
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
      failValidation(
        "\nYou must enter a value for the Version Name (Marketing Version)"
      );
      rl.close();
      return;
    }

    if (!VERSION_SEMANTIC_REGEX.test(newMarketingVersion)) {
      failValidation(
        "\nThe iOS version must follow the semantic versioning pattern (x.x.x)"
      );
      rl.close();
      return;
    }

    rl.question(newProjectVersionQuestion, (newProjectVersion) => {
      if (!newProjectVersion) {
        failValidation(
          "\nYou must enter a value for the Version Code (Build Version)"
        );
        rl.close();
        return;
      }

      const versionCode = Number(newProjectVersion);

      if (
        isNaN(versionCode) ||
        versionCode <= 0 ||
        !Number.isInteger(versionCode)
      ) {
        failValidation(
          "\nThe Version Code (Build Version) must be a positive integer"
        );
        rl.close();
        return;
      }

      try {
        const updatedIOSConfig = writeNewIOSVersion(
          projectName,
          newProjectVersion,
          newMarketingVersion
        );
        const isFinish = true;
        console.log("\n");
        statusIOSVersion(updatedIOSConfig, isFinish);
        console.log("\n");
      } catch (error) {
        handleCommandError(error);
      }

      rl.close();
    });
  });
});

program.parse(process.argv);
