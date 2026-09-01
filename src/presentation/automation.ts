import { AutomationCommand, AutomationResult } from "../application/automation";
import { BumpVersionError, isBumpVersionError } from "../lib/errors";

export const AUTOMATION_SCHEMA_VERSION = 1;

export interface AutomationSuccessDocument {
  schemaVersion: 1;
  ok: true;
  command: AutomationCommand;
  changed: boolean;
  dryRun: boolean;
  root: string;
  platforms: {
    android?: {
      path: string;
      before: NonNullable<AutomationResult["platforms"]["android"]>["before"];
      after: NonNullable<AutomationResult["platforms"]["android"]>["after"];
      matches: number;
      matchCounts: NonNullable<
        AutomationResult["platforms"]["android"]
      >["matches"];
    };
    ios?: {
      path: string;
      selection?: NonNullable<
        AutomationResult["platforms"]["ios"]
      >["selection"];
      before: NonNullable<AutomationResult["platforms"]["ios"]>["before"];
      after: NonNullable<AutomationResult["platforms"]["ios"]>["after"];
      matches: number;
      matchCounts: NonNullable<
        AutomationResult["platforms"]["ios"]
      >["matches"];
    };
  };
  warnings: string[];
}

export interface AutomationErrorDocument {
  schemaVersion: 1;
  ok: false;
  command: AutomationCommand;
  error: {
    code: string;
    message: string;
    hint: string;
    details: Record<string, unknown>;
  };
}

export function errorHint(error: unknown): string {
  if (!isBumpVersionError(error)) {
    return "Re-run with --debug and inspect the stack trace before retrying.";
  }

  if (error.code === "VALIDATION_ERROR") {
    return "Review the command help and provide every required option explicitly.";
  }

  if (error.code === "NOT_FOUND") {
    return error.details?.targets
      ? "Choose an exact target/configuration from details.targets."
      : "Check --root and any explicit file, module or project selector.";
  }

  if (error.code === "AMBIGUOUS") {
    return error.details?.targets
      ? "Pass --ios-target <name> or --all-targets; add --ios-configuration when needed."
      : "Select one supported source explicitly or make all reported candidates consistent.";
  }

  if (error.code === "PARSE_ERROR") {
    return error.details?.source === "xcconfig"
      ? "Update the .xcconfig with its own tool or select a configuration with direct literals."
      : "Use direct literals in the supported project block and review the reported candidates.";
  }

  if (error.code === "VERSION_CONFLICT") {
    return "Inspect current values and retry with an intentional, non-conflicting version policy.";
  }

  if (error.code === "CHECK_MISMATCH") {
    return "Run inspect --format json to compare the current and expected values.";
  }

  if (error.code === "CONCURRENT_MODIFICATION") {
    return "Discard the stale plan, inspect the file again and retry from fresh content.";
  }

  if (error.code === "WRITE_ERROR") {
    return "Check target permissions and parent-directory access before retrying.";
  }

  return "Inspect the target and rollback state; do not retry blindly.";
}

export function automationSuccessDocument(
  result: AutomationResult
): AutomationSuccessDocument {
  const platforms: AutomationSuccessDocument["platforms"] = {};

  if (result.platforms.android) {
    const android = result.platforms.android;
    platforms.android = {
      path: android.path,
      before: android.before,
      after: android.after,
      matches: android.matches.total,
      matchCounts: android.matches,
    };
  }

  if (result.platforms.ios) {
    const ios = result.platforms.ios;
    platforms.ios = {
      path: ios.path,
      ...(ios.selection ? { selection: ios.selection } : {}),
      before: ios.before,
      after: ios.after,
      matches: ios.matches.total,
      matchCounts: ios.matches,
    };
  }

  return {
    schemaVersion: AUTOMATION_SCHEMA_VERSION,
    ok: true,
    command: result.command,
    changed: result.changed,
    dryRun: result.dryRun,
    root: result.root,
    platforms,
    warnings: result.warnings,
  };
}

export function automationErrorDocument(
  command: AutomationCommand,
  error: unknown
): AutomationErrorDocument {
  if (isBumpVersionError(error)) {
    return {
      schemaVersion: AUTOMATION_SCHEMA_VERSION,
      ok: false,
      command,
      error: {
        code: error.code,
        message: error.message,
        hint: errorHint(error),
        details: {
          ...(error.path ? { path: error.path } : {}),
          ...(error.details ?? {}),
        },
      },
    };
  }

  return {
    schemaVersion: AUTOMATION_SCHEMA_VERSION,
    ok: false,
    command,
    error: {
      code: "INTERNAL_ERROR",
      message: error instanceof Error ? error.message : String(error),
      hint: errorHint(error),
      details: {},
    },
  };
}

export function errorDebugText(error: unknown): string | undefined {
  if (error instanceof BumpVersionError) {
    const cause = error.cause instanceof Error ? error.cause.stack : error.cause;
    return [error.stack, cause ? `Caused by: ${String(cause)}` : undefined]
      .filter(Boolean)
      .join("\n");
  }

  return error instanceof Error ? error.stack : undefined;
}
