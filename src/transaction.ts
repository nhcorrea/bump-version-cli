import { analyzeAndroid } from "./android";
import { BumpVersionError, createError } from "./errors";
import { analyzeIos } from "./ios";
import type {
  Host,
  MatchCounts,
  Platform,
  Selection,
  Source,
  TextRange,
  Versions,
} from "./types";
import {
  parsePositiveBuild,
  platformDisplayName,
  validateAndroidVersionCode,
  validateSemanticVersion,
} from "./version";

export interface ChangePlan {
  readonly platform: Platform;
  readonly path: string;
  readonly selection: Selection;
  readonly before: string;
  readonly after: string;
  readonly original: Versions;
  readonly requested: Versions;
  readonly builds: number;
  readonly marketing: number;
}

export function analyzePlatform(
  platform: Platform,
  text: string,
  path: string,
  selection: Selection,
): Source {
  return platform === "android"
    ? analyzeAndroid(text, path)
    : analyzeIos(text, path, selection);
}

export function createPlan(
  platform: Platform,
  path: string,
  selection: Selection,
  text: string,
  source: Source,
  requested: Versions,
  allowDowngrade: boolean,
): ChangePlan {
  const normalizedBuild = String(
    platform === "android"
      ? validateAndroidVersionCode(
          requested.build,
          source.current.build,
          allowDowngrade,
        )
      : parsePositiveBuild(requested.build, "CURRENT_PROJECT_VERSION"),
  );
  validateSemanticVersion(requested.marketing, platformDisplayName(platform));

  const normalizedRequested: Versions = {
    build: normalizedBuild,
    marketing: requested.marketing,
  };

  const edits: Array<{ span: TextRange; value: string }> = [
    ...source.builds.map((span) => ({ span, value: normalizedRequested.build })),
    ...source.marketing.map((span) => ({
      span,
      value: normalizedRequested.marketing,
    })),
  ];
  edits.sort((left, right) => left.span.start - right.span.start);

  const chunks: string[] = [];
  let cursor = 0;
  for (const edit of edits) {
    chunks.push(text.slice(cursor, edit.span.start), edit.value);
    cursor = edit.span.end;
  }
  chunks.push(text.slice(cursor));
  const after = chunks.join("");

  if (after !== text) {
    const verified = analyzePlatform(platform, after, path, selection).current;
    if (
      verified.build !== normalizedRequested.build ||
      verified.marketing !== normalizedRequested.marketing
    ) {
      throw createError(
        "VERIFY_ERROR",
        "Transformed values differ from the plan.",
        path,
      );
    }
  }

  return {
    platform,
    path,
    selection,
    before: text,
    after,
    original: source.current,
    requested: normalizedRequested,
    builds: source.builds.length,
    marketing: source.marketing.length,
  };
}

export function planChanged(plan: ChangePlan): boolean {
  return plan.before !== plan.after;
}

export function planMatches(plan: ChangePlan): MatchCounts {
  return {
    build: plan.builds,
    marketing: plan.marketing,
    total: plan.builds + plan.marketing,
  };
}

export function planHashes(plan: ChangePlan): [string, string] {
  const { createHash } = require("node:crypto") as typeof import("node:crypto");
  return [
    createHash("sha256").update(plan.before, "utf8").digest("hex"),
    createHash("sha256").update(plan.after, "utf8").digest("hex"),
  ];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function serializeError(error: BumpVersionError): Record<string, unknown> {
  return {
    code: error.code,
    message: error.message,
    path: error.path ?? "",
    details: error.details ?? {},
  };
}

function assertCurrent(host: Host, path: string, expected: string): void {
  let observed: string;
  try {
    observed = host.read(path);
  } catch (error) {
    throw createError("WRITE_ERROR", errorMessage(error), path);
  }
  if (observed !== expected) {
    throw createError(
      "CONCURRENT_MODIFICATION",
      "The target changed after the plan was created; create a new plan and retry.",
      path,
    );
  }
}

function replaceFile(
  host: Host,
  path: string,
  expected: string,
  nextContents: string,
): void {
  let kind: string;
  let canonical: string;
  try {
    kind = host.kind(path);
    canonical = host.canonical(path);
  } catch (error) {
    throw createError("WRITE_ERROR", errorMessage(error), path);
  }

  if (kind !== "file" || canonical !== path) {
    throw createError(
      "WRITE_ERROR",
      "Could not inspect target permissions before commit.",
      path,
    );
  }

  let staged: string;
  try {
    staged = host.stage(path, nextContents);
  } catch (error) {
    throw createError("WRITE_ERROR", errorMessage(error), path);
  }

  // Stage beside the destination, then verify the snapshot again immediately
  // before atomic rename. Never overwrite an unrelated edit during rollback.
  try {
    assertCurrent(host, path, expected);
    try {
      host.rename(staged, path);
    } catch (error) {
      throw createError("WRITE_ERROR", errorMessage(error), path);
    }
  } catch (cause) {
    try {
      host.remove(staged);
    } catch (cleanupError) {
      throw createError("WRITE_ERROR", errorMessage(cleanupError), path);
    }
    throw cause;
  }
}

export function commitPlans(host: Host, plans: readonly ChangePlan[]): void {
  for (const plan of plans) {
    assertCurrent(host, plan.path, plan.before);
  }

  const applied: ChangePlan[] = [];
  try {
    for (const plan of plans) {
      if (!planChanged(plan)) {
        assertCurrent(host, plan.path, plan.before);
        continue;
      }

      replaceFile(host, plan.path, plan.before, plan.after);
      applied.push(plan);

      let observed: string;
      try {
        observed = host.read(plan.path);
      } catch (error) {
        throw createError("VERIFY_ERROR", errorMessage(error), plan.path);
      }

      const verified =
        observed === plan.after
          ? analyzePlatform(plan.platform, observed, plan.path, plan.selection)
              .current
          : undefined;
      if (
        verified === undefined ||
        verified.build !== plan.requested.build ||
        verified.marketing !== plan.requested.marketing
      ) {
        throw createError(
          "VERIFY_ERROR",
          "Committed content failed verification.",
          plan.path,
        );
      }
    }
  } catch (cause) {
    const rollbackErrors: BumpVersionError[] = [];
    for (let i = applied.length - 1; i >= 0; i -= 1) {
      const plan = applied[i]!;
      try {
        replaceFile(host, plan.path, plan.after, plan.before);
        assertCurrent(host, plan.path, plan.before);
      } catch (restoreError) {
        rollbackErrors.push(
          restoreError instanceof BumpVersionError
            ? restoreError
            : createError("WRITE_ERROR", errorMessage(restoreError), plan.path),
        );
      }
    }

    if (rollbackErrors.length > 0) {
      const first = rollbackErrors[0]!;
      const commitErr =
        cause instanceof BumpVersionError
          ? serializeError(cause)
          : { code: "WRITE_ERROR", message: errorMessage(cause), path: first.path ?? "", details: {} };
      throw createError(
        "ROLLBACK_ERROR",
        "A multi-file commit failed and one or more applied targets could not be restored.",
        first.path ?? "",
        {
          commitError: commitErr,
          rollbackErrors: rollbackErrors.map(serializeError),
        },
      );
    }

    throw cause;
  }
}
