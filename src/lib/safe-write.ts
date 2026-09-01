import * as fs from "fs";
import { randomUUID } from "crypto";
import { basename, dirname, join } from "path";
import {
  AppliedChange,
  ChangePlan,
  hashContent,
} from "../core/change-plan";
import { BumpVersionError } from "./errors";

type ParseConfig<TConfig> = (content: string, path: string) => TConfig;

export interface CommitTarget<TConfig> {
  plan: ChangePlan<TConfig>;
  parseConfig: ParseConfig<TConfig>;
}

function temporaryPath(path: string, purpose: "commit" | "rollback"): string {
  return join(
    dirname(path),
    `.${basename(path)}.bump-version-${purpose}-${process.pid}-${randomUUID()}.tmp`
  );
}

function removeTemporaryFile(path: string | undefined): void {
  if (!path) {
    return;
  }

  try {
    fs.unlinkSync(path);
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
      throw error;
    }
  }
}

function writeTemporaryFile(path: string, content: string, mode: number): void {
  fs.writeFileSync(path, content, {
    encoding: "utf8",
    flag: "wx",
    mode,
  });
  fs.chmodSync(path, mode);
}

function assertPlanIsCurrent<TConfig>(plan: ChangePlan<TConfig>): void {
  let currentContent: string;

  try {
    currentContent = fs.readFileSync(plan.path, "utf8");
  } catch (error) {
    throw new BumpVersionError(
      "WRITE_ERROR",
      "Could not read the target immediately before commit.",
      plan.path,
      error
    );
  }

  if (hashContent(currentContent) !== plan.beforeHash) {
    throw new BumpVersionError(
      "CONCURRENT_MODIFICATION",
      "The target changed after the plan was created; create a new plan and retry.",
      plan.path
    );
  }
}

function rollback<TConfig>(
  plan: ChangePlan<TConfig>,
  mode: number
): void {
  let rollbackPath: string | undefined;

  try {
    rollbackPath = temporaryPath(plan.path, "rollback");
    writeTemporaryFile(rollbackPath, plan.beforeContent, mode);
    fs.renameSync(rollbackPath, plan.path);
    rollbackPath = undefined;

    const restored = fs.readFileSync(plan.path, "utf8");

    if (hashContent(restored) !== plan.beforeHash) {
      throw new Error("Rollback content hash does not match the original plan.");
    }
  } catch (error) {
    try {
      removeTemporaryFile(rollbackPath);
    } catch {
      // The rollback error below remains the primary diagnostic.
    }

    throw new BumpVersionError(
      "ROLLBACK_ERROR",
      "Verification failed and the original content could not be restored.",
      plan.path,
      error
    );
  }
}

export function commitChangePlan<TConfig>(
  plan: ChangePlan<TConfig>,
  parseConfig: ParseConfig<TConfig>
): AppliedChange<TConfig> {
  assertPlanIsCurrent(plan);

  if (!plan.changed) {
    return { plan, config: plan.after, changed: false };
  }

  let mode: number;

  try {
    const targetStat = fs.lstatSync(plan.path);

    if (!targetStat.isFile() || targetStat.isSymbolicLink()) {
      throw new Error("The target must be a regular file, not a symbolic link.");
    }

    mode = targetStat.mode & 0o777;
  } catch (error) {
    throw new BumpVersionError(
      "WRITE_ERROR",
      "Could not inspect target permissions before commit.",
      plan.path,
      error
    );
  }

  let commitPath: string | undefined;

  try {
    commitPath = temporaryPath(plan.path, "commit");
    writeTemporaryFile(commitPath, plan.afterContent, mode);
    assertPlanIsCurrent(plan);
    fs.renameSync(commitPath, plan.path);
    commitPath = undefined;
  } catch (error) {
    try {
      removeTemporaryFile(commitPath);
    } catch {
      // Preserve the commit failure as the primary diagnostic.
    }

    if (error instanceof BumpVersionError) {
      throw error;
    }

    throw new BumpVersionError(
      "WRITE_ERROR",
      "Could not atomically commit the planned content.",
      plan.path,
      error
    );
  }

  try {
    const verifiedContent = fs.readFileSync(plan.path, "utf8");
    const verified = parseConfig(verifiedContent, plan.path);

    if (hashContent(verifiedContent) !== plan.afterHash) {
      throw new Error("Committed content hash differs from the plan.");
    }

    return { plan, config: verified, changed: true };
  } catch (verificationError) {
    try {
      rollback(plan, mode);
    } catch (rollbackError) {
      if (rollbackError instanceof BumpVersionError) {
        throw new BumpVersionError(
          "ROLLBACK_ERROR",
          rollbackError.message,
          plan.path,
          { verificationError, rollbackError: rollbackError.cause }
        );
      }

      throw rollbackError;
    }

    throw new BumpVersionError(
      "VERIFY_ERROR",
      "Committed content failed verification; the original was restored.",
      plan.path,
      verificationError
    );
  }
}

function reversePlan<TConfig>(plan: ChangePlan<TConfig>): ChangePlan<TConfig> {
  return {
    ...plan,
    before: plan.after,
    after: plan.before,
    beforeContent: plan.afterContent,
    afterContent: plan.beforeContent,
    beforeHash: plan.afterHash,
    afterHash: plan.beforeHash,
  };
}

export function commitChangePlans<TConfig>(
  targets: ReadonlyArray<CommitTarget<TConfig>>
): Array<AppliedChange<TConfig>> {
  for (const { plan } of targets) {
    assertPlanIsCurrent(plan);
  }

  const applied: Array<{
    target: CommitTarget<TConfig>;
    result: AppliedChange<TConfig>;
  }> = [];

  try {
    for (const target of targets) {
      const result = commitChangePlan(target.plan, target.parseConfig);
      applied.push({ target, result });
    }

    return applied.map(({ result }) => result);
  } catch (commitError) {
    const rollbackErrors: unknown[] = [];

    for (const { target, result } of [...applied].reverse()) {
      if (!result.changed) {
        continue;
      }

      try {
        commitChangePlan(reversePlan(target.plan), target.parseConfig);
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
    }

    if (rollbackErrors.length > 0) {
      throw new BumpVersionError(
        "ROLLBACK_ERROR",
        "A multi-file commit failed and one or more applied targets could not be restored.",
        rollbackErrors[0] instanceof BumpVersionError
          ? rollbackErrors[0].path
          : targets[0]?.plan.path ?? "unknown",
        { commitError, rollbackErrors }
      );
    }

    if (commitError instanceof BumpVersionError) {
      throw commitError;
    }

    throw new BumpVersionError(
      "WRITE_ERROR",
      "A multi-file commit failed; applied targets were restored.",
      targets[0]?.plan.path ?? "unknown",
      commitError
    );
  }
}
