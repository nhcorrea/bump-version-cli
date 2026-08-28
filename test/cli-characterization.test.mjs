import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(testDirectory, "..");
const cliPath = join(repositoryRoot, "dist", "index.js");
const fixturesPath = join(testDirectory, "fixtures");

function copyFixture(name) {
  const destination = mkdtempSync(join(tmpdir(), `bump-version-${name}-`));
  cpSync(join(fixturesPath, name), destination, { recursive: true });
  return destination;
}

function runCli(args, options = {}) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd: options.cwd ?? repositoryRoot,
    encoding: "utf8",
    input: options.input,
    env: {
      ...process.env,
      NO_COLOR: "1",
    },
  });
}

function outputOf(result) {
  return `${result.stdout ?? ""}\n${result.stderr ?? ""}`.replace(
    // ANSI is currently unconditional. Strip it so characterization focuses on data.
    // eslint-disable-next-line no-control-regex
    /\u001B\[[0-?]*[ -/]*[@-~]/g,
    ""
  );
}

test("reads the supported Android Groovy syntax", () => {
  const cwd = copyFixture("android-groovy");
  const result = runCli(["android-version"], { cwd });
  const output = outputOf(result);

  assert.equal(result.status, 0);
  assert.match(output, /1\.2\.3/);
  assert.match(output, /41/);
  assert.doesNotMatch(output, /\bnull\b/);
});

test("prints the baseline command help", () => {
  const result = runCli(["--help"]);
  const output = outputOf(result);

  assert.equal(result.status, 0);
  assert.match(output, /CLI to manage project versions/);
  assert.match(output, /android-version/);
  assert.match(output, /ios-version <projectName>/);
  assert.match(output, /android \[options\]/);
  assert.match(output, /ios <projectName>/);
});

test("COR-01: preserves the project.pbxproj terminator after an iOS update", () => {
  const cwd = copyFixture("ios-basic");
  const result = runCli(["ios", "Audit"], {
    cwd,
    input: "1.2.4\n42\n",
  });
  const project = readFileSync(
    join(cwd, "ios", "Audit.xcodeproj", "project.pbxproj"),
    "utf8"
  );

  assert.equal(result.status, 0);
  assert.match(project, /CURRENT_PROJECT_VERSION = 42;/);
  assert.match(project, /MARKETING_VERSION = 1\.2\.4;/);
});

test("COR-02: displays iOS build and marketing values under the correct labels", () => {
  const cwd = copyFixture("ios-basic");
  const result = runCli(["ios-version", "Audit"], { cwd });
  const output = outputOf(result);

  assert.equal(result.status, 0);
  assert.match(output, /Current Project Version \(Build\):\s*41\b/);
  assert.match(output, /Marketing Version \(Marketing Version\):\s*1\.2\.3\b/);
});

test("COR-03: exits non-zero when the Android project file is missing", () => {
  const cwd = mkdtempSync(join(tmpdir(), "bump-version-missing-file-"));
  const result = runCli(["android-version"], { cwd });
  const output = outputOf(result);

  assert.equal(result.status, 3);
  assert.match(output, /NOT_FOUND/);
});

test("COR-04: reads Android assignments that use an equals sign", () => {
  const cwd = copyFixture("android-equals");
  const readResult = runCli(["android-version"], { cwd });
  const output = outputOf(readResult);

  assert.equal(readResult.status, 0);
  assert.match(output, /1\.2\.3/);
  assert.match(output, /41/);
  assert.doesNotMatch(output, /\bnull\b/);

  const updateResult = runCli(["android"], {
    cwd,
    input: "1.2.4\n42\n",
  });
  const project = readFileSync(
    join(cwd, "android", "app", "build.gradle"),
    "utf8"
  );

  assert.equal(updateResult.status, 0);
  assert.match(project, /versionCode = 42\b/);
  assert.match(project, /versionName = "1\.2\.4"/);
});

test("COR-05: does not report success when no Android version field is replaced", () => {
  const cwd = copyFixture("android-missing");
  const result = runCli(["android"], {
    cwd,
    input: "1.2.4\n42\n",
  });
  const output = outputOf(result);

  assert.equal(result.status, 4);
  assert.match(output, /PARSE_ERROR/);
  assert.doesNotMatch(output, /updated successfully/i);
});
