import { parseArgs, type ParseArgsConfig } from "node:util";
import type { AutomationCommand, AutomationOptions } from "./types";

export interface OptionSpec {
  readonly long: string;
  readonly short?: string;
  readonly flags: string;
  readonly description: string;
  readonly type: "string" | "boolean";
  readonly prop: keyof AutomationOptions | "help";
  readonly booleanValue?: boolean;
}

export interface CommandSpec {
  readonly name: string;
  readonly usage: string;
  readonly description: string;
  readonly automation?: AutomationCommand;
  readonly requiredArg?: string;
  readonly options: readonly OptionSpec[];
  readonly helpFooter?: string;
}

const HELP_OPTION: OptionSpec = {
  long: "help",
  short: "h",
  flags: "-h, --help",
  description: "display help for command",
  type: "boolean",
  prop: "help",
};

const PROJECT_OPTIONS: readonly OptionSpec[] = [
  {
    long: "root",
    flags: "--root <path>",
    description: "Project root (defaults to the current directory)",
    type: "string",
    prop: "root",
  },
  {
    long: "platform",
    flags: "--platform <platform>",
    description: "android, ios or all",
    type: "string",
    prop: "platform",
  },
  {
    long: "android-file",
    flags: "--android-file <path>",
    description: "Explicit build.gradle or build.gradle.kts",
    type: "string",
    prop: "androidFile",
  },
  {
    long: "android-module",
    flags: "--android-module <name>",
    description: "Android module name (defaults to app)",
    type: "string",
    prop: "androidModule",
  },
  {
    long: "ios-project",
    flags: "--ios-project <name-or-path>",
    description: "iOS project name or project path",
    type: "string",
    prop: "iosProject",
  },
  {
    long: "ios-target",
    flags: "--ios-target <name>",
    description: "Exact PBXNativeTarget name",
    type: "string",
    prop: "iosTarget",
  },
  {
    long: "ios-configuration",
    flags: "--ios-configuration <name>",
    description: "Exact iOS build configuration name",
    type: "string",
    prop: "iosConfiguration",
  },
  {
    long: "all-targets",
    flags: "--all-targets",
    description: "Select every PBXNativeTarget explicitly",
    type: "boolean",
    prop: "allTargets",
  },
  {
    long: "config",
    flags: "--config <path>",
    description: "Optional .bump-version.json path",
    type: "string",
    prop: "config",
  },
  {
    long: "non-interactive",
    flags: "--non-interactive",
    description: "Forbids interactive prompts",
    type: "boolean",
    prop: "nonInteractive",
  },
  {
    long: "format",
    flags: "--format <format>",
    description: 'human or json (default: "human")',
    type: "string",
    prop: "format",
  },
  {
    long: "output-file",
    flags: "--output-file <path>",
    description: "Writes the JSON result document to a file",
    type: "string",
    prop: "outputFile",
  },
  {
    long: "quiet",
    flags: "--quiet",
    description: "Suppresses non-essential diagnostics",
    type: "boolean",
    prop: "quiet",
  },
  {
    long: "debug",
    flags: "--debug",
    description: "Prints internal error details to stderr",
    type: "boolean",
    prop: "debug",
  },
  {
    long: "no-color",
    flags: "--no-color",
    description: "Disables ANSI colors",
    type: "boolean",
    prop: "color",
    booleanValue: false,
  },
];

const VERSION_OPTIONS: readonly OptionSpec[] = [
  {
    long: "app-version",
    flags: "--app-version <version>",
    description: "Marketing version shared by Android and iOS",
    type: "string",
    prop: "appVersion",
  },
  {
    long: "version-name",
    flags: "--version-name <version>",
    description: "Android versionName",
    type: "string",
    prop: "versionName",
  },
  {
    long: "version-code",
    flags: "--version-code <integer>",
    description: "Android versionCode",
    type: "string",
    prop: "versionCode",
  },
  {
    long: "marketing-version",
    flags: "--marketing-version <version>",
    description: "iOS MARKETING_VERSION",
    type: "string",
    prop: "marketingVersion",
  },
  {
    long: "build-number",
    flags: "--build-number <integer>",
    description: "iOS CURRENT_PROJECT_VERSION",
    type: "string",
    prop: "buildNumber",
  },
];

const DRY_RUN_OPTION: OptionSpec = {
  long: "dry-run",
  flags: "--dry-run",
  description: "Plans changes without writing files",
  type: "boolean",
  prop: "dryRun",
};

const ALLOW_DOWNGRADE_OPTION: OptionSpec = {
  long: "allow-downgrade",
  flags: "--allow-downgrade",
  description: "Allows Android versionCode downgrade",
  type: "boolean",
  prop: "allowDowngrade",
};

export const COMMANDS: readonly CommandSpec[] = [
  {
    name: "inspect",
    usage: "inspect [options]",
    description: "Inspect current project versions",
    automation: "inspect",
    options: [...PROJECT_OPTIONS, HELP_OPTION],
    helpFooter: [
      "Examples:",
      "  bump-version inspect --platform all",
      "  bump-version inspect --platform android --format json",
      "  bump-version inspect --platform ios --ios-target App --ios-configuration Release --format json",
    ].join("\n"),
  },
  {
    name: "set",
    usage: "set [options]",
    description: "Set exact project versions",
    automation: "set",
    options: [
      ...PROJECT_OPTIONS,
      ...VERSION_OPTIONS,
      DRY_RUN_OPTION,
      ALLOW_DOWNGRADE_OPTION,
      HELP_OPTION,
    ],
    helpFooter: [
      "Examples:",
      "  bump-version set --platform android --version-name 1.2.4 --version-code 42",
      "  bump-version set --platform ios --ios-target App --marketing-version 1.2.4 --build-number 42",
      "  bump-version set --platform all --app-version 1.2.4 --version-code 42 --build-number 42 --dry-run --format json",
    ].join("\n"),
  },
  {
    name: "bump",
    usage: "bump [options]",
    description: "Bump project marketing versions",
    automation: "bump",
    options: [
      ...PROJECT_OPTIONS,
      ...VERSION_OPTIONS,
      {
        long: "release",
        flags: "--release <type>",
        description: "major, minor or patch",
        type: "string",
        prop: "release",
      },
      {
        long: "increment-build",
        flags: "--increment-build",
        description: "Also increments platform build numbers",
        type: "boolean",
        prop: "incrementBuild",
      },
      DRY_RUN_OPTION,
      {
        long: "allow-downgrade",
        flags: "--allow-downgrade",
        description: "Allows explicit Android versionCode downgrade",
        type: "boolean",
        prop: "allowDowngrade",
      },
      HELP_OPTION,
    ],
    helpFooter: [
      "Example:",
      "  bump-version bump --platform all --release patch --increment-build --dry-run",
    ].join("\n"),
  },
  {
    name: "check",
    usage: "check [options]",
    description: "Check expected project versions",
    automation: "check",
    options: [...PROJECT_OPTIONS, ...VERSION_OPTIONS, HELP_OPTION],
    helpFooter: [
      "Example:",
      "  bump-version check --platform all --app-version 1.2.4 --format json",
    ].join("\n"),
  },
  {
    name: "android-version",
    usage: "android-version",
    description: "Deprecated: inspect the Android version",
    options: [HELP_OPTION],
  },
  {
    name: "ios-version",
    usage: "ios-version <projectName>",
    description: "Deprecated: inspect an iOS project version",
    requiredArg: "projectName",
    options: [HELP_OPTION],
  },
  {
    name: "android",
    usage: "android [options]",
    description: "Deprecated: update Android interactively",
    options: [
      {
        long: "version",
        short: "v",
        flags: "-v, --version",
        description: "Displays the current Android version",
        type: "boolean",
        prop: "version",
      },
      {
        long: "allow-downgrade",
        flags: "--allow-downgrade",
        description: "Allows versionCode to be lower than the current value",
        type: "boolean",
        prop: "allowDowngrade",
      },
      {
        long: "dry-run",
        flags: "--dry-run",
        description: "Plans the update without writing the file",
        type: "boolean",
        prop: "dryRun",
      },
      {
        long: "non-interactive",
        flags: "--non-interactive",
        description: "Disables the legacy interactive prompt",
        type: "boolean",
        prop: "nonInteractive",
      },
      {
        long: "no-color",
        flags: "--no-color",
        description: "Disables ANSI colors",
        type: "boolean",
        prop: "color",
        booleanValue: false,
      },
      HELP_OPTION,
    ],
  },
  {
    name: "ios",
    usage: "ios [options] <projectName>",
    description: "Deprecated: update iOS interactively",
    requiredArg: "projectName",
    options: [
      {
        long: "dry-run",
        flags: "--dry-run",
        description: "Plans the update without writing the file",
        type: "boolean",
        prop: "dryRun",
      },
      {
        long: "non-interactive",
        flags: "--non-interactive",
        description: "Disables the legacy interactive prompt",
        type: "boolean",
        prop: "nonInteractive",
      },
      {
        long: "no-color",
        flags: "--no-color",
        description: "Disables ANSI colors",
        type: "boolean",
        prop: "color",
        booleanValue: false,
      },
      HELP_OPTION,
    ],
  },
];

const COMMAND_MAP = new Map<string, CommandSpec>(
  COMMANDS.map((command) => [command.name, command]),
);

function formatTable(rows: ReadonlyArray<readonly [string, string]>): string[] {
  const width = Math.max(...rows.map(([left]) => left.length)) + 2;
  return rows.map(([left, right]) => `  ${left.padEnd(width)}${right}`);
}

export function formatRootHelp(): string {
  const options = formatTable([
    ["-V, --version", "output the version number"],
    ["-h, --help", "display help for command"],
  ]);
  const commands = formatTable([
    ...COMMANDS.map((cmd): [string, string] => [cmd.usage, cmd.description]),
    ["help [command]", "display help for command"],
  ]);

  return [
    "Usage: bump-version [options] [command]",
    "",
    "Read and update Android and iOS app versions",
    "",
    "Options:",
    ...options,
    "",
    "Commands:",
    ...commands,
    "",
    "Automation examples:",
    "  bump-version inspect --platform all --format json",
    "  bump-version inspect --platform ios --ios-target App --ios-configuration Release --format json",
    "  bump-version set --platform all --app-version 1.2.4 --version-code 42 --build-number 42",
    "  bump-version bump --platform all --release patch --increment-build --dry-run",
    "  bump-version check --platform all --app-version 1.2.4",
  ].join("\n");
}

export function formatCommandHelp(spec: CommandSpec): string {
  const optionRows = formatTable(
    spec.options.map((opt): [string, string] => [opt.flags, opt.description]),
  );
  const lines = [
    `Usage: bump-version ${spec.usage}`,
    "",
    spec.description,
    "",
    "Options:",
    ...optionRows,
  ];
  if (spec.helpFooter) {
    lines.push("", spec.helpFooter);
  }
  return lines.join("\n");
}

export function findCommandSpec(name: string): CommandSpec | undefined {
  return COMMAND_MAP.get(name);
}

export interface ParsedCommand {
  readonly spec: CommandSpec;
  readonly options: AutomationOptions;
  readonly positionals: string[];
  readonly help: boolean;
  readonly usageError: string | undefined;
}

export function parseSubcommandArgs(
  spec: CommandSpec,
  args: readonly string[],
): ParsedCommand {
  const optionMap = new Map<string, OptionSpec>();
  const configOptions: NonNullable<ParseArgsConfig["options"]> = {};

  for (const option of spec.options) {
    optionMap.set(option.long, option);
    configOptions[option.long] =
      option.short !== undefined
        ? { type: option.type, short: option.short }
        : { type: option.type };
  }

  const parsed = parseArgs({
    args: [...args],
    options: configOptions,
    strict: false,
    tokens: true,
    allowPositionals: true,
  });

  const options: AutomationOptions = {};
  const positionals: string[] = [];
  let help = false;
  let usageError: string | undefined;

  for (const token of parsed.tokens ?? []) {
    if (token.kind === "positional") {
      positionals.push(token.value);
      continue;
    }
    if (token.kind !== "option") {
      continue;
    }

    const optionSpec = optionMap.get(token.name);
    if (optionSpec === undefined) {
      usageError ??= `unknown option '${token.rawName}'`;
      continue;
    }

    if (optionSpec.type === "string") {
      if (typeof token.value !== "string") {
        usageError ??= `option '${optionSpec.flags}' argument missing`;
        continue;
      }
      (options as Record<string, unknown>)[optionSpec.prop] = token.value;
    } else {
      if (token.inlineValue === true) {
        usageError ??= `option '${token.rawName}' does not take an argument`;
        continue;
      }
      if (optionSpec.prop === "help") {
        help = true;
      } else {
        (options as Record<string, unknown>)[optionSpec.prop] =
          optionSpec.booleanValue ?? true;
      }
    }
  }

  if (!help && usageError === undefined) {
    const expected = spec.requiredArg ? 1 : 0;
    if (positionals.length < expected) {
      usageError = `missing required argument '${spec.requiredArg}'`;
    } else if (positionals.length > expected) {
      const noun = expected === 1 ? "argument" : "arguments";
      usageError = `too many arguments for '${spec.name}'. Expected ${expected} ${noun} but got ${positionals.length}.`;
    }
  }

  return {
    spec,
    options,
    positionals,
    help,
    usageError,
  };
}
