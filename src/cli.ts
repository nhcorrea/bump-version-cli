#!/usr/bin/env node
import * as readline from "readline";
import { resolve } from "path";
import { Command, CommanderError } from "commander";
import {
  applyAndroidChangePlan,
  createAndroidChangePlan,
  readAndroidBuildGradle,
} from "./lib/android";
import {
  applyIOSChangePlan,
  createIOSChangePlan,
  readIOSConfig,
} from "./lib/ios";
import { BumpVersionError, isBumpVersionError } from "./lib/errors";
import {
  validateAndroidVersionCode,
  validatePositiveBuildVersion,
  validateSemanticVersion,
} from "./core/version";
import { formatAndroidStatus, formatIOSStatus } from "./presentation/status";
import { ChangePlan } from "./core/change-plan";
import { AndroidConfig, IOSConfig } from "./types/types";
import {
  AutomationCommand,
  AutomationOptions,
  AutomationResult,
  executeAutomation,
} from "./application/automation";
import {
  automationErrorDocument,
  automationSuccessDocument,
  errorDebugText,
  errorHint,
} from "./presentation/automation";
import {
  resolveOutputFile,
  writeOutputDocument,
} from "./application/output-file";

const { version } = require("../package.json") as { version: string };

export interface CliRuntime {
  cwd: () => string;
  input: NodeJS.ReadableStream;
  output: NodeJS.WritableStream;
  log: (message?: string) => void;
  error: (message: string) => void;
  setExitCode: (code: number) => void;
}

const EXIT_CODE = {
  unexpected: 70,
  validation: 2,
  notFound: 3,
  parse: 4,
  conflict: 5,
  write: 6,
} as const;

const defaultRuntime: CliRuntime = {
  cwd: () => process.cwd(),
  input: process.stdin,
  output: process.stdout,
  log: (message = "") => console.log(message),
  error: (message) => console.error(message),
  setExitCode: (code) => {
    process.exitCode = code;
  },
};

function androidProjectPath(runtime: CliRuntime): string {
  return resolve(runtime.cwd(), "android", "app", "build.gradle");
}

function iosProjectPath(runtime: CliRuntime, projectName: string): string {
  return resolve(
    runtime.cwd(),
    "ios",
    `${projectName}.xcodeproj`,
    "project.pbxproj"
  );
}

function baseColor(text: string) {
  return `${text} `;
}

function isCIEnvironment(): boolean {
  const value = process.env.CI?.toLowerCase();
  return value !== undefined && value !== "" && value !== "0" && value !== "false";
}

function legacyWarning(runtime: CliRuntime, replacement: string): void {
  runtime.error(`DEPRECATED: use ${replacement}; the legacy command will be removed after the transition period.`);
}

function rejectLegacyPrompt(runtime: CliRuntime): void {
  handleCommandError(
    runtime,
    new BumpVersionError(
      "VALIDATION_ERROR",
      "Interactive legacy commands are disabled in CI/--non-interactive. Use set with explicit flags.",
      "non-interactive"
    )
  );
}

function handleCommandError(runtime: CliRuntime, error: unknown) {
  const exitCode = exitCodeForError(error);

  if (isBumpVersionError(error)) {
    const location = error.path ? ` (${error.path})` : "";

    runtime.error(`${error.code}: ${error.message}${location}`);
    runtime.error(`Hint: ${errorHint(error)}`);
    runtime.setExitCode(exitCode);
    return;
  }

  const message = error instanceof Error ? error.message : String(error);
  runtime.error(`UNEXPECTED_ERROR: ${message}`);
  runtime.error(`Hint: ${errorHint(error)}`);
  runtime.setExitCode(exitCode);
}

function exitCodeForError(error: unknown): number {
  if (!isBumpVersionError(error)) {
    return EXIT_CODE.unexpected;
  }

  if (error.code === "VALIDATION_ERROR") {
    return EXIT_CODE.validation;
  }

  if (error.code === "NOT_FOUND") {
    return EXIT_CODE.notFound;
  }

  if (error.code === "PARSE_ERROR" || error.code === "AMBIGUOUS") {
    return EXIT_CODE.parse;
  }

  if (error.code === "VERSION_CONFLICT" || error.code === "CHECK_MISMATCH") {
    return EXIT_CODE.conflict;
  }

  return EXIT_CODE.write;
}

function headerCLI(runtime: CliRuntime) {
  runtime.log(`bump-version ${version}`);
}

function showAndroidStatus(
  runtime: CliRuntime,
  config: ReturnType<typeof readAndroidBuildGradle>,
  isFinish = false
) {
  runtime.log("\n");
  runtime.log(formatAndroidStatus(config, isFinish));
  runtime.log("\n");
}

function showIOSStatus(
  runtime: CliRuntime,
  config: ReturnType<typeof readIOSConfig>,
  isFinish = false
) {
  runtime.log("\n");
  runtime.log(formatIOSStatus(config, isFinish));
  runtime.log("\n");
}

function showChangePlan(
  runtime: CliRuntime,
  plan: ChangePlan<AndroidConfig | IOSConfig>,
  dryRun: boolean
) {
  runtime.log(dryRun ? "Dry run: no files were written." : "No changes required.");
  runtime.log(`Path: ${plan.path}`);
  runtime.log(
    `Matches: build=${plan.matches.build}, marketing=${plan.matches.marketing}`
  );

  if (plan.platform === "android") {
    const before = plan.before as AndroidConfig;
    const after = plan.after as AndroidConfig;
    runtime.log(
      `Android: ${before.marketingVersion} (${before.buildVersion}) -> ${after.marketingVersion} (${after.buildVersion})`
    );
  } else {
    const before = plan.before as IOSConfig;
    const after = plan.after as IOSConfig;
    runtime.log(
      `iOS: ${before.MARKETING_VERSION} (${before.CURRENT_PROJECT_VERSION}) -> ${after.MARKETING_VERSION} (${after.CURRENT_PROJECT_VERSION})`
    );
  }
}

function addProjectOptions(command: Command): Command {
  return command
    .option("--root <path>", "Project root (defaults to the current directory)")
    .option("--platform <platform>", "android, ios or all")
    .option("--android-file <path>", "Explicit build.gradle or build.gradle.kts")
    .option("--android-module <name>", "Android module name (defaults to app)")
    .option("--ios-project <name-or-path>", "iOS project name or project path")
    .option("--ios-target <name>", "Exact PBXNativeTarget name")
    .option("--ios-configuration <name>", "Exact iOS build configuration name")
    .option("--all-targets", "Select every PBXNativeTarget explicitly")
    .option("--config <path>", "Optional .bump-version.json path")
    .option("--non-interactive", "Forbids interactive prompts")
    .option("--format <format>", "human or json", "human")
    .option("--output-file <path>", "Writes the JSON result document to a file")
    .option("--quiet", "Suppresses non-essential diagnostics")
    .option("--debug", "Prints internal error details to stderr")
    .option("--no-color", "Disables ANSI colors");
}

function addVersionOptions(command: Command): Command {
  return command
    .option("--app-version <version>", "Marketing version shared by Android and iOS")
    .option("--version-name <version>", "Android versionName")
    .option("--version-code <integer>", "Android versionCode")
    .option("--marketing-version <version>", "iOS MARKETING_VERSION")
    .option("--build-number <integer>", "iOS CURRENT_PROJECT_VERSION");
}

function formatAutomationResult(result: AutomationResult): string {
  const lines = [
    `${result.command}: ${
      result.changed
        ? result.dryRun
          ? "changes planned (dry-run)"
          : "changed"
        : "no changes"
    }`,
    `Root: ${result.root}`,
  ];

  if (result.platforms.android) {
    const android = result.platforms.android;
    lines.push(
      `Android  ${android.path}`,
      `  versionName  ${android.before.versionName} -> ${android.after.versionName}`,
      `  versionCode  ${android.before.versionCode} -> ${android.after.versionCode}`,
      `  matches      ${android.matches.total}`
    );
  }

  if (result.platforms.ios) {
    const ios = result.platforms.ios;
    lines.push(
      `iOS      ${ios.path}`,
      ...(ios.selection
        ? [
            `  selection    ${[
              ios.selection.allTargets ? "all targets" : ios.selection.target,
              ios.selection.configuration,
            ]
              .filter(Boolean)
              .join(" / ")}`,
          ]
        : []),
      `  marketing    ${ios.before.marketingVersion} -> ${ios.after.marketingVersion}`,
      `  build        ${ios.before.buildNumber} -> ${ios.after.buildNumber}`,
      `  matches      ${ios.matches.total}`
    );
  }

  return lines.join("\n");
}

function runAutomationCommand(
  runtime: CliRuntime,
  command: AutomationCommand,
  options: AutomationOptions
): void {
  const format = options.format ?? "human";
  let outputPath: string | undefined;

  try {
    if (format !== "human" && format !== "json") {
      throw new BumpVersionError(
        "VALIDATION_ERROR",
        "--format must be human or json.",
        "format"
      );
    }

    if (options.outputFile) {
      outputPath = resolveOutputFile({
        cwd: runtime.cwd(),
        root: options.root,
        outputFile: options.outputFile,
      });
    }

    const result = executeAutomation(command, options, runtime.cwd());
    const document = automationSuccessDocument(result);

    if (outputPath) {
      writeOutputDocument(outputPath, document);
    }

    runtime.log(
      format === "json"
        ? JSON.stringify(document, null, 2)
        : formatAutomationResult(result)
    );
  } catch (error) {
    if (format === "json") {
      const document = automationErrorDocument(command, error);

      if (
        outputPath &&
        !(isBumpVersionError(error) && error.path === outputPath)
      ) {
        try {
          writeOutputDocument(outputPath, document);
        } catch (outputError) {
          if (options.debug) {
            runtime.error(errorDebugText(outputError) ?? String(outputError));
          }
        }
      }

      runtime.log(JSON.stringify(document, null, 2));
      runtime.setExitCode(exitCodeForError(error));
    } else {
      handleCommandError(runtime, error);
    }

    if (options.debug) {
      const debug = errorDebugText(error);

      if (debug) {
        runtime.error(debug);
      }
    }
  }
}

export function createProgram(
  runtimeOverrides: Partial<CliRuntime> = {}
): Command {
  const runtime: CliRuntime = { ...defaultRuntime, ...runtimeOverrides };
  const program = new Command();

  program
    .name("bump-version")
    .version(version)
    .description("Read and update Android and iOS app versions");

  program.addHelpText(
    "after",
    [
      "",
      "Automation examples:",
      "  bump-version inspect --platform all --format json",
      "  bump-version inspect --platform ios --ios-target App --ios-configuration Release --format json",
      "  bump-version set --platform all --app-version 1.2.4 --version-code 42 --build-number 42",
      "  bump-version bump --platform all --release patch --increment-build --dry-run",
      "  bump-version check --platform all --app-version 1.2.4",
    ].join("\n")
  );

  const inspectCommand = addProjectOptions(
    program.command("inspect").description("Inspect current project versions")
  ).addHelpText(
    "after",
    "\nExamples:\n  bump-version inspect --platform all\n  bump-version inspect --platform android --format json\n  bump-version inspect --platform ios --ios-target App --ios-configuration Release --format json"
  );
  inspectCommand.action((options: AutomationOptions) => {
    runAutomationCommand(runtime, "inspect", options);
  });

  const setCommand = addVersionOptions(
    addProjectOptions(
      program.command("set").description("Set exact project versions")
    )
  )
    .option("--dry-run", "Plans changes without writing files")
    .option("--allow-downgrade", "Allows Android versionCode downgrade")
    .addHelpText(
      "after",
      [
        "",
        "Examples:",
        "  bump-version set --platform android --version-name 1.2.4 --version-code 42",
        "  bump-version set --platform ios --ios-target App --marketing-version 1.2.4 --build-number 42",
        "  bump-version set --platform all --app-version 1.2.4 --version-code 42 --build-number 42 --dry-run --format json",
      ].join("\n")
    );
  setCommand.action((options: AutomationOptions) => {
    runAutomationCommand(runtime, "set", options);
  });

  const bumpCommand = addVersionOptions(
    addProjectOptions(
      program.command("bump").description("Bump project marketing versions")
    )
  )
    .option("--release <type>", "major, minor or patch")
    .option("--increment-build", "Also increments platform build numbers")
    .option("--dry-run", "Plans changes without writing files")
    .option("--allow-downgrade", "Allows explicit Android versionCode downgrade")
    .addHelpText(
      "after",
      "\nExample:\n  bump-version bump --platform all --release patch --increment-build --dry-run"
    );
  bumpCommand.action((options: AutomationOptions) => {
    runAutomationCommand(runtime, "bump", options);
  });

  const checkCommand = addVersionOptions(
    addProjectOptions(
      program.command("check").description("Check expected project versions")
    )
  ).addHelpText(
    "after",
    "\nExample:\n  bump-version check --platform all --app-version 1.2.4 --format json"
  );
  checkCommand.action((options: AutomationOptions) => {
    runAutomationCommand(runtime, "check", options);
  });

  program
    .command("android-version")
    .description("Deprecated: inspect the Android version")
    .action(() => {
      if (isCIEnvironment()) {
        runAutomationCommand(runtime, "inspect", {
          platform: "android",
          nonInteractive: true,
        });
        return;
      }

      legacyWarning(runtime, "inspect --platform android");

      try {
        const androidConfig = readAndroidBuildGradle(
          androidProjectPath(runtime)
        );

        headerCLI(runtime);
        showAndroidStatus(runtime, androidConfig);
      } catch (error) {
        handleCommandError(runtime, error);
      }
    });

  program
    .command("ios-version <projectName>")
    .description("Deprecated: inspect an iOS project version")
    .action((projectName: string) => {
      if (isCIEnvironment()) {
        runAutomationCommand(runtime, "inspect", {
          platform: "ios",
          iosProject: projectName,
          nonInteractive: true,
        });
        return;
      }

      legacyWarning(
        runtime,
        `inspect --platform ios --ios-project ${projectName}`
      );

      try {
        const iosConfig = readIOSConfig(iosProjectPath(runtime, projectName));

        headerCLI(runtime);
        showIOSStatus(runtime, iosConfig);
      } catch (error) {
        handleCommandError(runtime, error);
      }
    });

  program
    .command("android")
    .description("Deprecated: update Android interactively")
    .option("-v, --version", "Displays the current Android version")
    .option(
      "--allow-downgrade",
      "Allows versionCode to be lower than the current value"
    )
    .option("--dry-run", "Plans the update without writing the file")
    .option("--non-interactive", "Disables the legacy interactive prompt")
    .option("--no-color", "Disables ANSI colors")
    .action((options: {
      allowDowngrade?: boolean;
      dryRun?: boolean;
      nonInteractive?: boolean;
    }) => {
      if (options.nonInteractive || isCIEnvironment()) {
        rejectLegacyPrompt(runtime);
        return;
      }

      legacyWarning(runtime, "set --platform android with explicit flags");
      const path = androidProjectPath(runtime);
      let androidConfig;

      try {
        androidConfig = readAndroidBuildGradle(path);
      } catch (error) {
        handleCommandError(runtime, error);
        return;
      }

      headerCLI(runtime);
      showAndroidStatus(runtime, androidConfig);

      const prompt = readline.createInterface({
        input: runtime.input,
        output: runtime.output,
      });
      const newCodeVersionQuestion = baseColor(
        `Enter the new Version Code (Build Version) (current: ${androidConfig.buildVersion}):`
      );
      const newVersionNameQuestion = baseColor(
        `Enter the new Version Name (Marketing Version) (current: ${androidConfig.marketingVersion}):`
      );

      prompt.question(newVersionNameQuestion, (newVersionName) => {
        try {
          validateSemanticVersion(newVersionName, "Android");
        } catch (error) {
          handleCommandError(runtime, error);
          prompt.close();
          return;
        }

        prompt.question(newCodeVersionQuestion, (newVersionCode) => {
          try {
            const normalizedVersionCode = validateAndroidVersionCode(
              newVersionCode,
              androidConfig.buildVersion,
              options.allowDowngrade ?? false
            );
            const plan = createAndroidChangePlan(
              path,
              normalizedVersionCode,
              newVersionName,
              { allowDowngrade: options.allowDowngrade ?? false }
            );

            if (options.dryRun) {
              showChangePlan(runtime, plan, true);
            } else {
              const applied = applyAndroidChangePlan(plan);

              if (applied.changed) {
                showAndroidStatus(runtime, applied.config, true);
              } else {
                showChangePlan(runtime, plan, false);
              }
            }
          } catch (error) {
            handleCommandError(runtime, error);
          }

          prompt.close();
        });
      });
    });

  program
    .command("ios <projectName>")
    .description("Deprecated: update iOS interactively")
    .option("--dry-run", "Plans the update without writing the file")
    .option("--non-interactive", "Disables the legacy interactive prompt")
    .option("--no-color", "Disables ANSI colors")
    .action((projectName: string, options: {
      dryRun?: boolean;
      nonInteractive?: boolean;
    }) => {
      if (options.nonInteractive || isCIEnvironment()) {
        rejectLegacyPrompt(runtime);
        return;
      }

      legacyWarning(
        runtime,
        `set --platform ios --ios-project ${projectName} with explicit flags`
      );
      const path = iosProjectPath(runtime, projectName);
      let iosConfig;

      try {
        iosConfig = readIOSConfig(path);
      } catch (error) {
        handleCommandError(runtime, error);
        return;
      }

      headerCLI(runtime);
      showIOSStatus(runtime, iosConfig);

      const prompt = readline.createInterface({
        input: runtime.input,
        output: runtime.output,
      });
      const newMarketingVersionQuestion = baseColor(
        "Enter the MARKETING_VERSION (Marketing Version):"
      );
      const newProjectVersionQuestion = baseColor(
        "Enter the CURRENT_PROJECT_VERSION (Build Version):"
      );

      prompt.question(newMarketingVersionQuestion, (newMarketingVersion) => {
        try {
          validateSemanticVersion(newMarketingVersion, "iOS");
        } catch (error) {
          handleCommandError(runtime, error);
          prompt.close();
          return;
        }

        prompt.question(newProjectVersionQuestion, (newProjectVersion) => {
          try {
            const normalizedBuildVersion = validatePositiveBuildVersion(
              newProjectVersion,
              "CURRENT_PROJECT_VERSION"
            );
            const plan = createIOSChangePlan(
              path,
              normalizedBuildVersion,
              newMarketingVersion
            );

            if (options.dryRun) {
              showChangePlan(runtime, plan, true);
            } else {
              const applied = applyIOSChangePlan(plan);

              if (applied.changed) {
                showIOSStatus(runtime, applied.config, true);
              } else {
                showChangePlan(runtime, plan, false);
              }
            }
          } catch (error) {
            handleCommandError(runtime, error);
          }

          prompt.close();
        });
      });
    });

  return program;
}

export function runCli(argv: readonly string[] = process.argv): void {
  const args = [...argv];
  const commandName = args[2];
  const automationCommands: AutomationCommand[] = [
    "inspect",
    "set",
    "bump",
    "check",
  ];
  const isAutomationCommand = automationCommands.includes(
    commandName as AutomationCommand
  );
  const formatIndex = args.indexOf("--format");
  const json = formatIndex >= 0 && args[formatIndex + 1] === "json";
  const program = createProgram();

  program.exitOverride();

  for (const command of program.commands) {
    command.exitOverride();
  }

  if (json && isAutomationCommand) {
    program.configureOutput({ writeErr: () => undefined });

    for (const command of program.commands) {
      command.configureOutput({ writeErr: () => undefined });
    }
  }

  try {
    program.parse(args);
  } catch (error) {
    if (!(error instanceof CommanderError)) {
      throw error;
    }

    if (error.exitCode === 0) {
      return;
    }

    process.exitCode = EXIT_CODE.validation;

    if (json && isAutomationCommand) {
      const commandError = new BumpVersionError(
        "VALIDATION_ERROR",
        error.message.replace(/^error:\s*/i, ""),
        "arguments"
      );
      const document = automationErrorDocument(
        commandName as AutomationCommand,
        commandError
      );
      process.stdout.write(`${JSON.stringify(document, null, 2)}\n`);
    }
  }
}

if (require.main === module) {
  runCli();
}
