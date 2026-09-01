import * as fs from "fs";
import { randomUUID } from "crypto";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "path";
import { BumpVersionError } from "../lib/errors";
import { resolveProjectRoot } from "./paths";

function isInside(root: string, target: string): boolean {
  const relation = relative(root, target);
  return relation === "" || (!relation.startsWith(`..${sep}`) && relation !== "..");
}

export function resolveOutputFile(options: {
  cwd: string;
  root?: string;
  outputFile: string;
}): string {
  const root = resolveProjectRoot(options.cwd, options.root);
  const target = isAbsolute(options.outputFile)
    ? resolve(options.outputFile)
    : resolve(root, options.outputFile);

  if (!isInside(root, target)) {
    throw new BumpVersionError(
      "VALIDATION_ERROR",
      "--output-file must be inside the project root.",
      target
    );
  }

  let realParent: string;

  try {
    realParent = fs.realpathSync(dirname(target));
  } catch (error) {
    throw new BumpVersionError(
      "NOT_FOUND",
      "The --output-file parent directory does not exist.",
      dirname(target),
      error
    );
  }

  if (!isInside(root, realParent)) {
    throw new BumpVersionError(
      "VALIDATION_ERROR",
      "--output-file resolves outside the project root.",
      target
    );
  }

  if (fs.existsSync(target)) {
    const targetStat = fs.lstatSync(target);

    if (!targetStat.isFile() || targetStat.isSymbolicLink()) {
      throw new BumpVersionError(
        "VALIDATION_ERROR",
        "--output-file must target a regular file.",
        target
      );
    }
  }

  return target;
}

export function writeOutputDocument(path: string, document: unknown): void {
  const temporary = resolve(
    dirname(path),
    `.${basename(path)}.bump-version-output-${process.pid}-${randomUUID()}.tmp`
  );
  const content = `${JSON.stringify(document, null, 2)}\n`;

  try {
    const mode = fs.existsSync(path) ? fs.statSync(path).mode & 0o777 : 0o600;
    fs.writeFileSync(temporary, content, {
      encoding: "utf8",
      flag: "wx",
      mode,
    });
    fs.chmodSync(temporary, mode);
    fs.renameSync(temporary, path);
  } catch (error) {
    try {
      fs.unlinkSync(temporary);
    } catch {
      // Preserve the output failure as the primary diagnostic.
    }

    throw new BumpVersionError(
      "WRITE_ERROR",
      "Could not write the automation result document.",
      path,
      error
    );
  }
}
