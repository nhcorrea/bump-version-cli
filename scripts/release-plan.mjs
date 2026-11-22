import assert from "node:assert/strict";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  compareSemver,
  isValidSemver,
  planRelease,
} from "./release-commits.mjs";
import { describeSpawnFailure, spawnCommandSync } from "./spawn-command.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const defaultRepositoryRoot = resolve(scriptDirectory, "..");

function parseArgs(argv) {
  const options = {
    cwd: defaultRepositoryRoot,
    ref: "HEAD",
    verifyHeadMatches: null,
    expectedVersion: null,
    githubOutput: null,
    notesFile: null,
    json: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") {
      options.json = true;
    } else if (arg === "--cwd") {
      options.cwd = resolve(argv[++index] ?? "");
    } else if (arg === "--ref") {
      options.ref = argv[++index] ?? "";
    } else if (arg === "--verify-head-matches") {
      options.verifyHeadMatches = argv[++index] ?? "";
    } else if (arg === "--expected-version") {
      options.expectedVersion = argv[++index] ?? "";
    } else if (arg === "--github-output") {
      options.githubOutput = argv[++index] ?? "";
    } else if (arg === "--notes-file") {
      options.notesFile = argv[++index] ?? "";
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  assert.ok(options.ref, "--ref requires a non-empty value");
  return options;
}

function runGit(cwd, args) {
  const result = spawnCommandSync("git", args, {
    cwd,
    encoding: "utf8",
  });
  assert.equal(
    result.status,
    0,
    `git ${args.join(" ")} failed: ${describeSpawnFailure(result)}`
  );
  return result.stdout;
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

function findLatestTag(cwd, ref) {
  const tags = runGit(cwd, ["tag", "--list", "v*", "--merged", ref])
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((tag) => tag.startsWith("v") && isValidSemver(tag.slice(1)));

  if (tags.length === 0) {
    return null;
  }

  tags.sort((left, right) => compareSemver(right.slice(1), left.slice(1)));
  return tags[0];
}

function readCommits(cwd, range) {
  const raw = runGit(cwd, [
    "log",
    "--no-merges",
    "--format=%H%x1f%s%x1f%b%x1e",
    range,
  ]);
  if (!raw.trim()) {
    return [];
  }

  return raw
    .split("\x1e")
    .map((entry) => entry.replace(/^\r?\n/, ""))
    .filter((entry) => entry.length > 0)
    .map((entry) => {
      const [hash = "", subject = "", body = ""] = entry.split("\x1f");
      return { hash: hash.trim(), subject: subject.trim(), body };
    });
}

function writeGithubOutput(path, values) {
  const lines = Object.entries(values).map(
    ([key, value]) => `${key}=${value ?? ""}`
  );
  appendFileSync(path, `${lines.join("\n")}\n`, "utf8");
}

const options = parseArgs(process.argv.slice(2));
const packageJson = JSON.parse(
  readFileSync(join(options.cwd, "package.json"), "utf8")
);
const changelogPath = join(options.cwd, "CHANGELOG.md");
const existingChangelog = existsSync(changelogPath)
  ? readFileSync(changelogPath, "utf8")
  : "";
const commitSha = runGit(options.cwd, ["rev-parse", options.ref]).trim();

let plan;
if (options.verifyHeadMatches) {
  const remoteSha = runGit(options.cwd, [
    "rev-parse",
    options.verifyHeadMatches,
  ]).trim();
  if (commitSha !== remoteSha) {
    plan = {
      shouldRelease: false,
      reason: `${options.ref} (${commitSha.slice(0, 7)}) is behind ${options.verifyHeadMatches} (${remoteSha.slice(0, 7)}); skipping superseded run.`,
      currentVersion: packageJson.version,
      latestTag: null,
      bump: "none",
      version: null,
      tag: null,
      previousTag: null,
      notes: "",
      updateFiles: false,
      commitSha,
    };
  }
}

if (!plan) {
  const latestTag = findLatestTag(options.cwd, options.ref);
  const range = latestTag ? `${latestTag}..${options.ref}` : options.ref;
  const commits = readCommits(options.cwd, range);
  const repoUrl = normalizeRepositoryUrl(packageJson.repository);
  plan = {
    ...planRelease({
      currentVersion: packageJson.version,
      latestTag,
      commits,
      existingChangelog,
      repoUrl,
    }),
    commitSha,
  };
}

if (options.expectedVersion) {
  assert.equal(
    plan.shouldRelease,
    true,
    `Expected release ${options.expectedVersion}, but planner returned shouldRelease=false (${plan.reason})`
  );
  assert.equal(
    plan.version,
    options.expectedVersion,
    `Planned release version ${plan.version} does not match expected ${options.expectedVersion}`
  );
}

if (options.notesFile && plan.shouldRelease) {
  writeFileSync(options.notesFile, `${plan.notes.trim()}\n`, "utf8");
}

if (options.githubOutput) {
  writeGithubOutput(options.githubOutput, {
    should_release: String(plan.shouldRelease),
    version: plan.version ?? "",
    tag: plan.tag ?? "",
    bump: plan.bump ?? "none",
    previous_tag: plan.previousTag ?? "",
    update_files: String(plan.updateFiles),
    commit_sha: plan.commitSha,
  });
}

if (options.json) {
  process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
} else {
  const summary = plan.shouldRelease
    ? `Release planned: ${plan.tag} (${plan.bump}) — ${plan.reason}`
    : `No release: ${plan.reason}`;
  process.stdout.write(`${summary}\n`);
}
