#!/usr/bin/env node
const readline = require("node:readline");
const { Command, CommanderError } = require("commander");
const { BumpVersionError, isBumpVersionError } = require("./errors.cjs");
const {
  automationErrorDocument,
  automationSuccessDocument,
  errorDebugText,
  errorHint,
} = require("./presentation/automation.cjs");
const { request } = require("./engine.cjs");
const { version } = require("../package.json");
const EXIT_CODE = {
  unexpected: 70,
  validation: 2,
  notFound: 3,
  parse: 4,
  conflict: 5,
  write: 6,
};
const defaultRuntime = {
  cwd: () => process.cwd(),
  input: process.stdin,
  output: process.stdout,
  log: (message = "") => console.log(message),
  error: (message) => console.error(message),
  setExitCode: (code) => {
    process.exitCode = code;
  },
};
function isCIEnvironment() {
  const value = process.env.CI?.toLowerCase();
  return (
    value !== undefined && value !== "" && value !== "0" && value !== "false"
  );
}
function legacyWarning(runtime, replacement) {
  runtime.error(
    `DEPRECATED: use ${replacement}; the legacy command will be removed after the transition period.`,
  );
}
function rejectLegacyPrompt(runtime) {
  handleCommandError(
    runtime,
    new BumpVersionError(
      "VALIDATION_ERROR",
      "Interactive legacy commands are disabled in CI/--non-interactive. Use set with explicit flags.",
      "non-interactive",
    ),
  );
}
function handleCommandError(runtime, error) {
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
function exitCodeForError(error) {
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
function headerCLI(runtime) {
  runtime.log(`bump-version ${version}`);
}
function showStatus(runtime, platform, config, finished = false) {
  const android = platform === "android";
  const title = android ? "Android" : "iOS";
  const header = finished
    ? title + " version updated successfully!"
    : android
      ? "Current Android version:"
      : "Current iOS app version:";
  runtime.log("\n");
  runtime.log(
    [
      header,
      ...(android
        ? [
            "Version Name (Marketing Version): " + config.marketing,
            "Version Code (Build): " + config.build,
          ]
        : [
            "Current Project Version (Build): " + config.build,
            "Marketing Version (Marketing Version): " + config.marketing,
          ]),
    ].join("\n"),
  );
  runtime.log("\n");
}

function interactive(runtime, platform, name, options) {
  if (options.nonInteractive || isCIEnvironment())
    return rejectLegacyPrompt(runtime);
  legacyWarning(runtime, "set --platform " + platform + " with explicit flags");
  let data, current;
  try {
    data = { operation: "legacy", platform, name, cwd: runtime.cwd() };
    current = request(data);
  } catch (error) {
    handleCommandError(runtime, error);
    return;
  }
  headerCLI(runtime);
  showStatus(runtime, platform, current);
  const android = platform === "android";
  const display = android ? "Android" : "iOS";
  const prompt = readline.createInterface({
    input: runtime.input,
    output: runtime.output,
  });
  const marketingQuestion = android
    ? "Enter the new Version Name (Marketing Version) (current: " +
      current.marketing +
      "): "
    : "Enter the MARKETING_VERSION (Marketing Version): ";
  const buildQuestion = android
    ? "Enter the new Version Code (Build Version) (current: " +
      current.build +
      "): "
    : "Enter the CURRENT_PROJECT_VERSION (Build Version): ";
  prompt.question(marketingQuestion, (marketing) => {
    try {
      request({ operation: "semantic", value: marketing, platform: display });
    } catch (error) {
      handleCommandError(runtime, error);
      prompt.close();
      return;
    }
    prompt.question(buildQuestion, (build) => {
      try {
        const plan = request({ ...data, ...options, marketing, build });
        if (plan.changed && !options.dryRun) {
          showStatus(runtime, platform, plan.after, true);
        } else {
          runtime.log(
            options.dryRun
              ? "Dry run: no files were written."
              : "No changes required.",
          );
          runtime.log("Path: " + plan.path);
          runtime.log(
            "Matches: build=" +
              plan.matches.build +
              ", marketing=" +
              plan.matches.marketing,
          );
          runtime.log(
            display +
              ": " +
              plan.before.marketing +
              " (" +
              plan.before.build +
              ") -> " +
              plan.after.marketing +
              " (" +
              plan.after.build +
              ")",
          );
        }
      } catch (error) {
        handleCommandError(runtime, error);
      } finally {
        prompt.close();
      }
    });
  });
}
function addProjectOptions(command) {
  return command
    .option("--root <path>", "Project root (defaults to the current directory)")
    .option("--platform <platform>", "android, ios or all")
    .option(
      "--android-file <path>",
      "Explicit build.gradle or build.gradle.kts",
    )
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
function addVersionOptions(command) {
  return command
    .option(
      "--app-version <version>",
      "Marketing version shared by Android and iOS",
    )
    .option("--version-name <version>", "Android versionName")
    .option("--version-code <integer>", "Android versionCode")
    .option("--marketing-version <version>", "iOS MARKETING_VERSION")
    .option("--build-number <integer>", "iOS CURRENT_PROJECT_VERSION");
}
function formatAutomationResult(result) {
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
      `  matches      ${android.matches.total}`,
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
      `  matches      ${ios.matches.total}`,
    );
  }
  return lines.join("\n");
}
function runAutomationCommand(runtime, command, options, usageError) {
  const format = options.format ?? "human";
  let outputPath, cwd;
  const writeOutput = (document) =>
    request({
      operation: "writeOutput",
      cwd,
      root: options.root,
      path: outputPath,
      document: JSON.stringify(document, null, 2) + "\n",
    });
  try {
    if (format !== "human" && format !== "json") {
      throw new BumpVersionError(
        "VALIDATION_ERROR",
        "--format must be human or json.",
        "format",
      );
    }
    cwd = runtime.cwd();
    if (options.outputFile) {
      outputPath = request({
        operation: "output",
        options,
        cwd,
        root: options.root,
        path: options.outputFile,
      });
    }
    if (usageError) throw usageError;
    const result = request({ operation: "run", command, options, cwd });
    const document = automationSuccessDocument(result);
    if (outputPath) {
      writeOutput(document);
    }
    runtime.log(
      format === "json"
        ? JSON.stringify(document, null, 2)
        : formatAutomationResult(result),
    );
  } catch (error) {
    if (format === "json") {
      let document = automationErrorDocument(command, error);
      if (
        outputPath &&
        !(isBumpVersionError(error) && error.path === outputPath)
      ) {
        try {
          writeOutput(document);
        } catch (outputError) {
          if (options.debug) runtime.error(errorDebugText(error) ?? String(error));
          error = outputError;
          document = automationErrorDocument(command, error);
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
function createProgram(runtimeOverrides = {}) {
  const runtime = { ...defaultRuntime, ...runtimeOverrides };
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
    ].join("\n"),
  );
  const inspectCommand = addProjectOptions(
    program.command("inspect").description("Inspect current project versions"),
  ).addHelpText(
    "after",
    "\nExamples:\n  bump-version inspect --platform all\n  bump-version inspect --platform android --format json\n  bump-version inspect --platform ios --ios-target App --ios-configuration Release --format json",
  );
  inspectCommand.action((options) => {
    runAutomationCommand(runtime, "inspect", options);
  });
  const setCommand = addVersionOptions(
    addProjectOptions(
      program.command("set").description("Set exact project versions"),
    ),
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
      ].join("\n"),
    );
  setCommand.action((options) => {
    runAutomationCommand(runtime, "set", options);
  });
  const bumpCommand = addVersionOptions(
    addProjectOptions(
      program.command("bump").description("Bump project marketing versions"),
    ),
  )
    .option("--release <type>", "major, minor or patch")
    .option("--increment-build", "Also increments platform build numbers")
    .option("--dry-run", "Plans changes without writing files")
    .option(
      "--allow-downgrade",
      "Allows explicit Android versionCode downgrade",
    )
    .addHelpText(
      "after",
      "\nExample:\n  bump-version bump --platform all --release patch --increment-build --dry-run",
    );
  bumpCommand.action((options) => {
    runAutomationCommand(runtime, "bump", options);
  });
  const checkCommand = addVersionOptions(
    addProjectOptions(
      program.command("check").description("Check expected project versions"),
    ),
  ).addHelpText(
    "after",
    "\nExample:\n  bump-version check --platform all --app-version 1.2.4 --format json",
  );
  checkCommand.action((options) => {
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
        const androidConfig = request({
          operation: "legacy",
          platform: "android",
          cwd: runtime.cwd(),
        });
        headerCLI(runtime);
        showStatus(runtime, "android", androidConfig);
      } catch (error) {
        handleCommandError(runtime, error);
      }
    });
  program
    .command("ios-version <projectName>")
    .description("Deprecated: inspect an iOS project version")
    .action((projectName) => {
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
        `inspect --platform ios --ios-project ${projectName}`,
      );
      try {
        const iosConfig = request({
          operation: "legacy",
          platform: "ios",
          cwd: runtime.cwd(),
          name: projectName,
        });
        headerCLI(runtime);
        showStatus(runtime, "ios", iosConfig);
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
      "Allows versionCode to be lower than the current value",
    )
    .option("--dry-run", "Plans the update without writing the file")
    .option("--non-interactive", "Disables the legacy interactive prompt")
    .option("--no-color", "Disables ANSI colors")
    .action((options) => interactive(runtime, "android", undefined, options));
  program
    .command("ios <projectName>")
    .description("Deprecated: update iOS interactively")
    .option("--dry-run", "Plans the update without writing the file")
    .option("--non-interactive", "Disables the legacy interactive prompt")
    .option("--no-color", "Disables ANSI colors")
    .action((name, options) => interactive(runtime, "ios", name, options));
  return program;
}
function runCli(argv = process.argv) {
  const args = [...argv];
  const commandName = args[2];
  const automationCommands = ["inspect", "set", "bump", "check"];
  const isAutomationCommand = automationCommands.includes(commandName);
  const formatIndex = args.indexOf("--format");
  const json =
    (formatIndex >= 0 && args[formatIndex + 1] === "json") ||
    args.includes("--format=json");
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
        "arguments",
      );
      const parsed = program.commands
        .find((command) => command.name() === commandName)
        .opts();
      runAutomationCommand(
        defaultRuntime,
        commandName,
        { ...parsed, format: "json" },
        commandError,
      );
    }
  }
}
module.exports = { createProgram, runCli };
if (require.main === module) {
  runCli();
}
