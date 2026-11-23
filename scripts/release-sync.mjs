import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseSemver,
  updateChangelog,
  updatePackageJsonVersion,
} from "./release-commits.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const defaultRepositoryRoot = resolve(scriptDirectory, "..");

function parseArgs(argv) {
  const options = {
    cwd: defaultRepositoryRoot,
    version: null,
    previousTag: null,
    notesFile: null,
    date: new Date().toISOString().slice(0, 10),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--cwd") {
      options.cwd = resolve(argv[++index] ?? "");
    } else if (arg === "--version") {
      options.version = argv[++index] ?? "";
    } else if (arg === "--previous-tag") {
      options.previousTag = argv[++index] ?? "";
    } else if (arg === "--notes-file") {
      options.notesFile = argv[++index] ?? "";
    } else if (arg === "--date") {
      options.date = argv[++index] ?? "";
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  assert.ok(options.version, "--version is required");
  parseSemver(options.version);
  assert.match(options.date, /^\d{4}-\d{2}-\d{2}$/, "--date must be YYYY-MM-DD");
  return options;
}

function normalizeRepositoryUrl(repositoryField) {
  const raw =
    typeof repositoryField === "string"
      ? repositoryField
      : repositoryField?.url ?? "";
  return raw
    .replace(/^git\+/, "")
    .replace(/\.git$/, "")
    .replace(/\/+$/, "");
}

function writeIfChanged(path, nextContent) {
  const previousContent = readFileSync(path, "utf8");
  if (previousContent === nextContent) {
    return false;
  }
  writeFileSync(path, nextContent, "utf8");
  return true;
}

const options = parseArgs(process.argv.slice(2));
const packageJsonPath = join(options.cwd, "package.json");
const changelogPath = join(options.cwd, "CHANGELOG.md");

const packageJsonText = readFileSync(packageJsonPath, "utf8");
const packageJson = JSON.parse(packageJsonText);

const changedFiles = [];

if (
  writeIfChanged(
    packageJsonPath,
    updatePackageJsonVersion(packageJsonText, options.version)
  )
) {
  changedFiles.push("package.json");
}

if (existsSync(changelogPath)) {
  const changelogText = readFileSync(changelogPath, "utf8");
  const notes = options.notesFile
    ? readFileSync(options.notesFile, "utf8").trim()
    : `Release v${options.version}.`;
  const nextChangelog = updateChangelog(changelogText, {
    version: options.version,
    date: options.date,
    notes,
    previousTag: options.previousTag || null,
    repoUrl: normalizeRepositoryUrl(packageJson.repository),
  });
  if (writeIfChanged(changelogPath, nextChangelog)) {
    changedFiles.push("CHANGELOG.md");
  }
}

process.stdout.write(
  changedFiles.length > 0
    ? `Release sync OK (${options.version}): updated ${changedFiles.join(", ")}\n`
    : `Release sync OK (${options.version}): files already up to date\n`
);
