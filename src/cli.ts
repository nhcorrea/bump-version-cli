#!/usr/bin/env node
import { version } from "../package.json";
import { runAutomation, runLegacyRead, runLegacyUpdate } from "./automation";
import {
  findCommandSpec,
  formatCommandHelp,
  formatRootHelp,
  parseSubcommandArgs,
} from "./cli-parser";
import { BumpVersionError, isBumpVersionError } from "./errors";
import { nodeHost } from "./host";
import {
  automationErrorDocument,
  automationSuccessDocument,
  errorDebugText,
  errorHint,
  formatAutomationResult,
} from "./presentation/automation";
import {
  resolveRoot,
  validateReportPath,
  writeOutputDocument,
} from "./project";
import type {
  AutomationCommand,
  AutomationOptions,
  CliRuntime,
  Platform,
  Versions,
} from "./types";
import { validateSemanticVersion } from "./version";

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
  error: (message = "") => console.error(message),
  setExitCode: (code) => {
    process.exitCode = code;
  },
};

function isCIEnvironment(): boolean {
  const value = process.env.CI?.toLowerCase();
  return (
    value !== undefined && value !== "" && value !== "0" && value !== "false"
  );
}

function legacyWarning(runtime: CliRuntime, replacement: string): void {
  runtime.error(
    `DEPRECATED: use ${replacement}; the legacy command will be removed after the transition period.`,
  );
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

function handleCommandError(runtime: CliRuntime, error: unknown): void {
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

function rejectLegacyPrompt(runtime: CliRuntime): void {
  handleCommandError(
    runtime,
    new BumpVersionError(
      "VALIDATION_ERROR",
      "Interactive legacy commands are disabled in CI/--non-interactive. Use set with explicit flags.",
      "non-interactive",
    ),
  );
}

function headerCLI(runtime: CliRuntime): void {
  runtime.log(`bump-version ${version}`);
}

function showStatus(
  runtime: CliRuntime,
  platform: Platform,
  config: Versions,
  finished = false,
): void {
  const android = platform === "android";
  const title = android ? "Android" : "iOS";
  const header = finished
    ? `${title} version updated successfully!`
    : android
      ? "Current Android version:"
      : "Current iOS app version:";
  runtime.log("\n");
  runtime.log(
    [
      header,
      ...(android
        ? [
            `Version Name (Marketing Version): ${config.marketing}`,
            `Version Code (Build): ${config.build}`,
          ]
        : [
            `Current Project Version (Build): ${config.build}`,
            `Marketing Version (Marketing Version): ${config.marketing}`,
          ]),
    ].join("\n"),
  );
  runtime.log("\n");
}

function interactive(
  runtime: CliRuntime,
  platform: Platform,
  name: string | undefined,
  options: AutomationOptions,
): void {
  if (options.nonInteractive || isCIEnvironment()) {
    rejectLegacyPrompt(runtime);
    return;
  }
  legacyWarning(
    runtime,
    `set --platform ${platform} with explicit flags`,
  );

  let cwd: string;
  let current: Versions;
  try {
    cwd = runtime.cwd();
    current = runLegacyRead(nodeHost, {
      platform,
      ...(name !== undefined ? { name } : {}),
      cwd,
    });
  } catch (error) {
    handleCommandError(runtime, error);
    return;
  }

  headerCLI(runtime);
  showStatus(runtime, platform, current);
  const android = platform === "android";
  const display = android ? "Android" : "iOS";
  const readline = require("node:readline") as typeof import("node:readline");
  const prompt = readline.createInterface({
    input: runtime.input,
    output: runtime.output,
  });
  const marketingQuestion = android
    ? `Enter the new Version Name (Marketing Version) (current: ${current.marketing}): `
    : "Enter the MARKETING_VERSION (Marketing Version): ";
  const buildQuestion = android
    ? `Enter the new Version Code (Build Version) (current: ${current.build}): `
    : "Enter the CURRENT_PROJECT_VERSION (Build Version): ";

  prompt.question(marketingQuestion, (marketing) => {
    try {
      validateSemanticVersion(marketing, display);
    } catch (error) {
      handleCommandError(runtime, error);
      prompt.close();
      return;
    }
    prompt.question(buildQuestion, (build) => {
      try {
        const plan = runLegacyUpdate(nodeHost, {
          platform,
          ...(name !== undefined ? { name } : {}),
          cwd,
          marketing,
          build,
          ...(options.dryRun !== undefined ? { dryRun: options.dryRun } : {}),
          ...(options.allowDowngrade !== undefined
            ? { allowDowngrade: options.allowDowngrade }
            : {}),
        });
        if (plan.changed && !options.dryRun) {
          showStatus(runtime, platform, plan.after, true);
        } else {
          runtime.log(
            options.dryRun
              ? "Dry run: no files were written."
              : "No changes required.",
          );
          runtime.log(`Path: ${plan.path}`);
          runtime.log(
            `Matches: build=${plan.matches.build}, marketing=${plan.matches.marketing}`,
          );
          runtime.log(
            `${display}: ${plan.before.marketing} (${plan.before.build}) -> ${plan.after.marketing} (${plan.after.build})`,
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

function runAutomationCommand(
  runtime: CliRuntime,
  command: AutomationCommand,
  options: AutomationOptions,
  usageError?: BumpVersionError,
): void {
  const format = options.format ?? "human";
  let outputPath: string | undefined;
  let resolvedRoot: string | undefined;

  const writeOutput = (document: unknown): void => {
    if (outputPath === undefined || resolvedRoot === undefined) {
      return;
    }
    writeOutputDocument(
      nodeHost,
      resolvedRoot,
      outputPath,
      `${JSON.stringify(document, null, 2)}\n`,
    );
  };

  try {
    if (format !== "human" && format !== "json") {
      throw new BumpVersionError(
        "VALIDATION_ERROR",
        "--format must be human or json.",
        "format",
      );
    }

    const cwd = runtime.cwd();
    if (options.outputFile !== undefined) {
      resolvedRoot = resolveRoot(nodeHost, cwd, options.root ?? ".");
      outputPath = validateReportPath(
        nodeHost,
        resolvedRoot,
        options.outputFile,
        options,
      );
    }

    if (usageError) {
      throw usageError;
    }

    const result = runAutomation(nodeHost, command, options, cwd);
    const document = automationSuccessDocument(result);
    if (outputPath !== undefined) {
      writeOutput(document);
    }
    runtime.log(
      format === "json"
        ? JSON.stringify(document, null, 2)
        : formatAutomationResult(result),
    );
  } catch (caught) {
    let error: unknown = caught;
    if (format === "json") {
      let document = automationErrorDocument(command, error);
      if (
        outputPath !== undefined &&
        !(isBumpVersionError(error) && error.path === outputPath)
      ) {
        try {
          writeOutput(document);
        } catch (outputError) {
          if (options.debug) {
            runtime.error(errorDebugText(error) ?? String(error));
          }
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

export interface CliParseOptions {
  from?: "node" | "user";
}

export interface CliProgram {
  name(): string;
  parse(argv?: readonly string[], options?: CliParseOptions): void;
}

export function createProgram(
  runtimeOverrides: Partial<CliRuntime> & { clear?: () => void } = {},
): CliProgram {
  const runtime: CliRuntime = { ...defaultRuntime, ...runtimeOverrides };

  return {
    name: () => "bump-version",
    parse(argv: readonly string[] = process.argv, parseOptions?: CliParseOptions) {
      const args =
        parseOptions?.from === "user" ? [...argv] : argv.slice(2);

      if (args.length === 0) {
        runtime.error(formatRootHelp());
        runtime.setExitCode(1);
        return;
      }

      const first = args[0]!;
      if (first === "-V" || first === "--version") {
        runtime.log(version);
        return;
      }
      if (first === "-h" || first === "--help") {
        runtime.log(formatRootHelp());
        return;
      }
      if (first === "help") {
        const target = args[1];
        if (!target) {
          runtime.log(formatRootHelp());
          return;
        }
        const spec = findCommandSpec(target);
        if (!spec) {
          runtime.error(`error: unknown command '${target}'`);
          runtime.setExitCode(EXIT_CODE.validation);
          return;
        }
        runtime.log(formatCommandHelp(spec));
        return;
      }

      if (first.startsWith("-")) {
        runtime.error(`error: unknown option '${first}'`);
        runtime.setExitCode(EXIT_CODE.validation);
        return;
      }

      const spec = findCommandSpec(first);
      if (!spec) {
        runtime.error(`error: unknown command '${first}'`);
        runtime.setExitCode(EXIT_CODE.validation);
        return;
      }

      const parsed = parseSubcommandArgs(spec, args.slice(1));
      if (parsed.help) {
        runtime.log(formatCommandHelp(spec));
        return;
      }

      if (spec.automation) {
        if (parsed.usageError !== undefined) {
          if (parsed.options.format === "json") {
            runAutomationCommand(
              runtime,
              spec.automation,
              { ...parsed.options, format: "json" },
              new BumpVersionError(
                "VALIDATION_ERROR",
                parsed.usageError,
                "arguments",
              ),
            );
          } else {
            runtime.error(`error: ${parsed.usageError}`);
            runtime.setExitCode(EXIT_CODE.validation);
          }
          return;
        }
        runAutomationCommand(runtime, spec.automation, parsed.options);
        return;
      }

      if (parsed.usageError !== undefined) {
        runtime.error(`error: ${parsed.usageError}`);
        runtime.setExitCode(EXIT_CODE.validation);
        return;
      }

      switch (spec.name) {
        case "android-version": {
          if (isCIEnvironment()) {
            runAutomationCommand(runtime, "inspect", {
              platform: "android",
              nonInteractive: true,
            });
            return;
          }
          legacyWarning(runtime, "inspect --platform android");
          try {
            const androidConfig = runLegacyRead(nodeHost, {
              platform: "android",
              cwd: runtime.cwd(),
            });
            headerCLI(runtime);
            showStatus(runtime, "android", androidConfig);
          } catch (error) {
            handleCommandError(runtime, error);
          }
          return;
        }
        case "ios-version": {
          const projectName = parsed.positionals[0]!;
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
            const iosConfig = runLegacyRead(nodeHost, {
              platform: "ios",
              cwd: runtime.cwd(),
              name: projectName,
            });
            headerCLI(runtime);
            showStatus(runtime, "ios", iosConfig);
          } catch (error) {
            handleCommandError(runtime, error);
          }
          return;
        }
        case "android": {
          interactive(runtime, "android", undefined, parsed.options);
          return;
        }
        case "ios": {
          interactive(runtime, "ios", parsed.positionals[0]!, parsed.options);
          return;
        }
      }
    },
  };
}

export function runCli(argv: readonly string[] = process.argv): void {
  createProgram().parse(argv);
}

if (require.main === module) {
  runCli();
}
