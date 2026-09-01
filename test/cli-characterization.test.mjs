import assert from "node:assert/strict";
import {
  chmodSync,
  cpSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(testDirectory, "..");
const cliPath = join(repositoryRoot, "dist", "cli.js");
const fixturesPath = join(testDirectory, "fixtures");
const packageJson = JSON.parse(
  readFileSync(join(repositoryRoot, "package.json"), "utf8")
);

function copyFixture(name) {
  const destination = mkdtempSync(join(tmpdir(), `bump-version-${name}-`));
  cpSync(join(fixturesPath, name), destination, { recursive: true });
  return destination;
}

function copyFixtures(...names) {
  const destination = mkdtempSync(join(tmpdir(), "bump-version-mobile-all-"));

  for (const name of names) {
    cpSync(join(fixturesPath, name), destination, { recursive: true });
  }

  return destination;
}

function runCli(args, options = {}) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd: options.cwd ?? repositoryRoot,
    encoding: "utf8",
    input: options.input,
    env: {
      ...process.env,
      // Test cases opt into CI behavior explicitly through options.env.
      CI: "false",
      NO_COLOR: "1",
      ...options.env,
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
  assert.match(output, /Read and update Android and iOS app versions/);
  assert.match(output, /inspect \[options\]/);
  assert.match(output, /set \[options\]/);
  assert.match(output, /bump \[options\]/);
  assert.match(output, /check \[options\]/);
  assert.match(output, /android-version/);
  assert.match(output, /ios-version <projectName>/);
  assert.match(output, /android \[options\]/);
  assert.match(output, /ios \[options\] <projectName>/);
  assert.match(output, /Automation examples:/);
  assert.match(output, /bump-version set --platform all/);
});

test("prints actionable subcommand examples", () => {
  const result = runCli(["set", "--help"]);

  assert.equal(result.status, 0);
  assert.equal(result.stderr, "");
  assert.match(result.stdout, /Examples:/);
  assert.match(result.stdout, /--platform android/);
  assert.match(result.stdout, /--ios-target App/);
  assert.match(result.stdout, /--ios-configuration <name>/);
  assert.match(result.stdout, /--all-targets/);
  assert.match(result.stdout, /--dry-run --format json/);
});

test("prints the CLI version as one plain line", () => {
  const result = runCli(["--version"]);

  assert.equal(result.status, 0);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout, `${packageJson.version}\n`);
  assert.doesNotMatch(result.stdout, /\u001B\[/);
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

test("updates Kotlin DSL defaultConfig while preserving comments", () => {
  const root = copyFixture("android-kotlin");
  const projectPath = join(root, "android", "app", "build.gradle.kts");
  const result = runCli([
    "set",
    "--platform",
    "android",
    "--root",
    root,
    "--version-name",
    "1.2.4",
    "--version-code",
    "42",
    "--format",
    "json",
  ]);
  const project = readFileSync(projectPath, "utf8");

  assert.equal(result.status, 0);
  assert.equal(JSON.parse(result.stdout).platforms.android.path, "android/app/build.gradle.kts");
  assert.match(project, /\/\/ versionCode = 999 must remain a comment\./);
  assert.match(project, /versionCode = 42 \/\/ keep build comment/);
  assert.match(project, /versionName = "1\.2\.4" \/\/ keep marketing comment/);
});

test("rejects Android flavor overrides as ambiguous before writing", () => {
  const root = copyFixture("android-flavor-overrides");
  const projectPath = join(root, "android", "app", "build.gradle");
  const before = readFileSync(projectPath, "utf8");
  const result = runCli([
    "set",
    "--platform",
    "android",
    "--root",
    root,
    "--version-name",
    "1.2.4",
    "--version-code",
    "42",
    "--format",
    "json",
  ]);
  const document = JSON.parse(result.stdout);

  assert.equal(result.status, 4);
  assert.equal(document.error.code, "AMBIGUOUS");
  assert.equal(document.error.details.candidates[0].scope, "override");
  assert.equal(readFileSync(projectPath, "utf8"), before);
});

test("rejects an indirect Kotlin version source before writing", () => {
  const root = copyFixture("android-indirect");
  const projectPath = join(root, "android", "app", "build.gradle.kts");
  const before = readFileSync(projectPath, "utf8");
  const result = runCli([
    "set",
    "--platform",
    "android",
    "--root",
    root,
    "--version-name",
    "1.2.4",
    "--version-code",
    "42",
    "--format",
    "json",
  ]);
  const document = JSON.parse(result.stdout);

  assert.equal(result.status, 4);
  assert.equal(document.error.code, "PARSE_ERROR");
  assert.match(document.error.message, /direct kotlin literal assignment/);
  assert.equal(readFileSync(projectPath, "utf8"), before);
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

test("rejects an Android versionCode downgrade without changing the file", () => {
  const cwd = copyFixture("android-groovy");
  const projectPath = join(cwd, "android", "app", "build.gradle");
  const before = readFileSync(projectPath, "utf8");
  const result = runCli(["android"], {
    cwd,
    input: "1.2.4\n40\n",
  });
  const output = outputOf(result);

  assert.equal(result.status, 5);
  assert.match(output, /VERSION_CONFLICT/);
  assert.match(output, /--allow-downgrade/);
  assert.equal(readFileSync(projectPath, "utf8"), before);
});

test("allows an explicit Android versionCode downgrade", () => {
  const cwd = copyFixture("android-groovy");
  const projectPath = join(cwd, "android", "app", "build.gradle");
  const result = runCli(["android", "--allow-downgrade"], {
    cwd,
    input: "1.2.4\n40\n",
  });
  const project = readFileSync(projectPath, "utf8");

  assert.equal(result.status, 0);
  assert.match(project, /versionCode 40\b/);
  assert.match(project, /versionName "1\.2\.4"/);
});

test("plans an Android dry-run without writing the file", () => {
  const cwd = copyFixture("android-groovy");
  const projectPath = join(cwd, "android", "app", "build.gradle");
  const before = readFileSync(projectPath, "utf8");
  const result = runCli(["android", "--dry-run"], {
    cwd,
    input: "1.2.4\n42\n",
  });
  const output = outputOf(result);

  assert.equal(result.status, 0);
  assert.equal(readFileSync(projectPath, "utf8"), before);
  assert.match(output, /Dry run: no files were written/);
  assert.match(output, /Matches: build=1, marketing=1/);
  assert.match(output, /1\.2\.3 \(41\) -> 1\.2\.4 \(42\)/);
  assert.doesNotMatch(output, /updated successfully/i);
});

test("plans an iOS dry-run without writing the file", () => {
  const cwd = copyFixture("ios-basic");
  const projectPath = join(
    cwd,
    "ios",
    "Audit.xcodeproj",
    "project.pbxproj"
  );
  const before = readFileSync(projectPath, "utf8");
  const result = runCli(["ios", "Audit", "--dry-run"], {
    cwd,
    input: "1.2.4\n42\n",
  });
  const output = outputOf(result);

  assert.equal(result.status, 0);
  assert.equal(readFileSync(projectPath, "utf8"), before);
  assert.match(output, /Dry run: no files were written/);
  assert.match(output, /Matches: build=1, marketing=1/);
  assert.match(output, /1\.2\.3 \(41\) -> 1\.2\.4 \(42\)/);
  assert.doesNotMatch(output, /updated successfully/i);
});

test("updates consistent iOS buildSettings blocks together", () => {
  const root = copyFixture("ios-multiple-consistent");
  const projectPath = join(
    root,
    "ios",
    "Multi.xcodeproj",
    "project.pbxproj"
  );
  const result = runCli([
    "set",
    "--platform",
    "ios",
    "--root",
    root,
    "--marketing-version",
    "1.2.4",
    "--build-number",
    "42",
    "--format",
    "json",
  ]);
  const document = JSON.parse(result.stdout);
  const project = readFileSync(projectPath, "utf8");

  assert.equal(result.status, 0);
  assert.deepEqual(document.platforms.ios.matchCounts, {
    build: 2,
    marketing: 2,
    total: 4,
  });
  assert.equal((project.match(/CURRENT_PROJECT_VERSION = 42;/g) ?? []).length, 1);
  assert.equal((project.match(/CURRENT_PROJECT_VERSION = "42";/g) ?? []).length, 1);
  assert.equal((project.match(/MARKETING_VERSION = 1\.2\.4;/g) ?? []).length, 1);
  assert.equal((project.match(/MARKETING_VERSION = "1\.2\.4";/g) ?? []).length, 1);
  assert.equal((project.match(/PRODUCT_NAME = "\$\(TARGET_NAME\)";/g) ?? []).length, 2);
});

test("rejects divergent iOS buildSettings before writing", () => {
  const root = copyFixture("ios-divergent");
  const projectPath = join(
    root,
    "ios",
    "Divergent.xcodeproj",
    "project.pbxproj"
  );
  const before = readFileSync(projectPath, "utf8");
  const result = runCli([
    "set",
    "--platform",
    "ios",
    "--root",
    root,
    "--marketing-version",
    "2.0.0",
    "--build-number",
    "50",
    "--format",
    "json",
  ]);
  const document = JSON.parse(result.stdout);

  assert.equal(result.status, 4);
  assert.equal(document.error.code, "AMBIGUOUS");
  assert.equal(document.error.details.candidates.length, 4);
  assert.equal(readFileSync(projectPath, "utf8"), before);
});

test("requires explicit selection when a project has multiple iOS targets", () => {
  const root = copyFixture("ios-targets");
  const result = runCli([
    "inspect",
    "--platform",
    "ios",
    "--root",
    root,
    "--format",
    "json",
  ]);
  const document = JSON.parse(result.stdout);

  assert.equal(result.status, 4);
  assert.equal(document.error.code, "AMBIGUOUS");
  assert.match(document.error.message, /--ios-target or --all-targets/);
  assert.deepEqual(
    document.error.details.targets.map(({ name }) => name),
    ["App", "Widget"]
  );
  assert.deepEqual(document.error.details.targets[0].configurations, [
    "Debug",
    "Release",
  ]);
});

test("updates only the explicitly selected iOS target", () => {
  const root = copyFixture("ios-targets");
  const projectPath = join(
    root,
    "ios",
    "Targets.xcodeproj",
    "project.pbxproj"
  );
  const result = runCli([
    "set",
    "--platform",
    "ios",
    "--root",
    root,
    "--ios-target",
    "App",
    "--marketing-version",
    "1.2.4",
    "--build-number",
    "42",
    "--format",
    "json",
  ]);
  const document = JSON.parse(result.stdout);
  const project = readFileSync(projectPath, "utf8");

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.deepEqual(document.platforms.ios.selection, { target: "App" });
  assert.deepEqual(document.platforms.ios.matchCounts, {
    build: 2,
    marketing: 2,
    total: 4,
  });
  assert.equal((project.match(/CURRENT_PROJECT_VERSION = 42;/g) ?? []).length, 1);
  assert.equal((project.match(/CURRENT_PROJECT_VERSION = "42";/g) ?? []).length, 1);
  assert.equal((project.match(/CURRENT_PROJECT_VERSION = 7;/g) ?? []).length, 2);
  assert.equal((project.match(/CURRENT_PROJECT_VERSION = 999;/g) ?? []).length, 2);
  assert.equal((project.match(/MARKETING_VERSION = 2\.0\.0;/g) ?? []).length, 2);
  assert.equal((project.match(/MARKETING_VERSION = 9\.9\.9;/g) ?? []).length, 2);
});

test("updates only one iOS target configuration when selected", () => {
  const root = copyFixture("ios-targets");
  const projectPath = join(
    root,
    "ios",
    "Targets.xcodeproj",
    "project.pbxproj"
  );
  const result = runCli([
    "set",
    "--platform",
    "ios",
    "--root",
    root,
    "--ios-target",
    "Widget",
    "--ios-configuration",
    "Release",
    "--marketing-version",
    "2.1.0",
    "--build-number",
    "8",
    "--format",
    "json",
  ]);
  const document = JSON.parse(result.stdout);
  const project = readFileSync(projectPath, "utf8");

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.deepEqual(document.platforms.ios.selection, {
    target: "Widget",
    configuration: "Release",
  });
  assert.deepEqual(document.platforms.ios.matchCounts, {
    build: 1,
    marketing: 1,
    total: 2,
  });
  assert.equal((project.match(/CURRENT_PROJECT_VERSION = 8;/g) ?? []).length, 1);
  assert.equal((project.match(/CURRENT_PROJECT_VERSION = 7;/g) ?? []).length, 1);
  assert.equal((project.match(/MARKETING_VERSION = 2\.1\.0;/g) ?? []).length, 1);
  assert.equal((project.match(/MARKETING_VERSION = 2\.0\.0;/g) ?? []).length, 1);
});

test("updates every iOS target only after explicit all-targets selection", () => {
  const root = copyFixture("ios-targets");
  const projectPath = join(
    root,
    "ios",
    "Targets.xcodeproj",
    "project.pbxproj"
  );
  const alignWidget = runCli([
    "set",
    "--platform",
    "ios",
    "--root",
    root,
    "--ios-target",
    "Widget",
    "--marketing-version",
    "1.2.3",
    "--build-number",
    "41",
  ]);
  const result = runCli([
    "set",
    "--platform",
    "ios",
    "--root",
    root,
    "--all-targets",
    "--marketing-version",
    "1.2.4",
    "--build-number",
    "42",
    "--format",
    "json",
  ]);
  const document = JSON.parse(result.stdout);
  const project = readFileSync(projectPath, "utf8");

  assert.equal(alignWidget.status, 0, alignWidget.stderr || alignWidget.stdout);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.deepEqual(document.platforms.ios.selection, { allTargets: true });
  assert.deepEqual(document.platforms.ios.matchCounts, {
    build: 4,
    marketing: 4,
    total: 8,
  });
  assert.equal((project.match(/CURRENT_PROJECT_VERSION = 42;/g) ?? []).length, 3);
  assert.equal((project.match(/CURRENT_PROJECT_VERSION = "42";/g) ?? []).length, 1);
  assert.equal((project.match(/MARKETING_VERSION = 1\.2\.4;/g) ?? []).length, 3);
  assert.equal((project.match(/MARKETING_VERSION = "1\.2\.4";/g) ?? []).length, 1);
  assert.equal((project.match(/CURRENT_PROJECT_VERSION = 999;/g) ?? []).length, 2);
});

test("rejects unknown and conflicting iOS selectors before writing", () => {
  const root = copyFixture("ios-targets");
  const projectPath = join(
    root,
    "ios",
    "Targets.xcodeproj",
    "project.pbxproj"
  );
  const before = readFileSync(projectPath, "utf8");
  const unknown = runCli([
    "inspect",
    "--platform",
    "ios",
    "--root",
    root,
    "--ios-target",
    "App",
    "--ios-configuration",
    "Profile",
    "--format",
    "json",
  ]);
  const conflicting = runCli([
    "set",
    "--platform",
    "ios",
    "--root",
    root,
    "--ios-target",
    "App",
    "--all-targets",
    "--marketing-version",
    "1.2.4",
    "--build-number",
    "42",
    "--format",
    "json",
  ]);

  assert.equal(unknown.status, 3);
  assert.equal(JSON.parse(unknown.stdout).error.code, "NOT_FOUND");
  assert.equal(conflicting.status, 2);
  assert.equal(JSON.parse(conflicting.stdout).error.code, "VALIDATION_ERROR");
  assert.equal(readFileSync(projectPath, "utf8"), before);
});

test("rejects indirect iOS version variables before writing", () => {
  const root = copyFixture("ios-indirect");
  const projectPath = join(
    root,
    "ios",
    "Indirect.xcodeproj",
    "project.pbxproj"
  );
  const before = readFileSync(projectPath, "utf8");
  const result = runCli([
    "set",
    "--platform",
    "ios",
    "--root",
    root,
    "--marketing-version",
    "2.0.0",
    "--build-number",
    "50",
    "--format",
    "json",
  ]);
  const document = JSON.parse(result.stdout);

  assert.equal(result.status, 4);
  assert.equal(document.error.code, "PARSE_ERROR");
  assert.match(document.error.message, /variables or inherited values/);
  assert.equal(readFileSync(projectPath, "utf8"), before);
});

test("reports an xcconfig version source explicitly", () => {
  const root = copyFixture("ios-xcconfig");
  const result = runCli([
    "inspect",
    "--platform",
    "ios",
    "--root",
    root,
    "--format",
    "json",
  ]);
  const document = JSON.parse(result.stdout);

  assert.equal(result.status, 4);
  assert.equal(document.error.code, "PARSE_ERROR");
  assert.equal(document.error.details.source, "xcconfig");
  assert.match(document.error.message, /\.xcconfig/);
});

test("reports an Android no-op without rewriting the file", () => {
  const cwd = copyFixture("android-groovy");
  const projectPath = join(cwd, "android", "app", "build.gradle");
  const before = readFileSync(projectPath, "utf8");
  const result = runCli(["android"], {
    cwd,
    input: "1.2.3\n41\n",
  });
  const output = outputOf(result);

  assert.equal(result.status, 0);
  assert.equal(readFileSync(projectPath, "utf8"), before);
  assert.match(output, /No changes required/);
  assert.doesNotMatch(output, /updated successfully/i);
});

test("inspects Android non-interactively with stdin closed", () => {
  const root = copyFixture("android-groovy");
  const result = runCli([
    "inspect",
    "--platform",
    "android",
    "--root",
    root,
    "--non-interactive",
  ]);
  const output = outputOf(result);

  assert.equal(result.status, 0);
  assert.match(output, /inspect: no changes/);
  assert.match(output, /Android\s+android\/app\/build\.gradle/);
  assert.match(output, /versionName\s+1\.2\.3 -> 1\.2\.3/);
  assert.match(output, /versionCode\s+41 -> 41/);
  assert.doesNotMatch(output, /created by:/);
  assert.doesNotMatch(result.stdout, /\u001B\[/);
});

test("sets Android and iOS atomically without prompts", () => {
  const root = copyFixtures("android-groovy", "ios-basic");
  const result = runCli([
    "set",
    "--platform",
    "all",
    "--root",
    root,
    "--app-version",
    "1.2.4",
    "--version-code",
    "42",
    "--build-number",
    "42",
    "--non-interactive",
  ]);
  const output = outputOf(result);

  assert.equal(result.status, 0);
  assert.match(output, /set: changed/);
  assert.match(
    readFileSync(join(root, "android", "app", "build.gradle"), "utf8"),
    /versionCode 42[\s\S]*versionName "1\.2\.4"/
  );
  assert.match(
    readFileSync(
      join(root, "ios", "Audit.xcodeproj", "project.pbxproj"),
      "utf8"
    ),
    /CURRENT_PROJECT_VERSION = 42;[\s\S]*MARKETING_VERSION = 1\.2\.4;/
  );
});

test("retries an automation set as an idempotent no-op", () => {
  const root = copyFixtures("android-groovy", "ios-basic");
  const androidPath = join(root, "android", "app", "build.gradle");
  const iosPath = join(root, "ios", "Audit.xcodeproj", "project.pbxproj");
  const androidBefore = readFileSync(androidPath, "utf8");
  const iosBefore = readFileSync(iosPath, "utf8");
  const result = runCli([
    "set",
    "--platform",
    "all",
    "--root",
    root,
    "--app-version",
    "1.2.3",
    "--version-code",
    "41",
    "--build-number",
    "41",
    "--format",
    "json",
  ]);
  const document = JSON.parse(result.stdout);

  assert.equal(result.status, 0);
  assert.equal(document.ok, true);
  assert.equal(document.changed, false);
  assert.equal(readFileSync(androidPath, "utf8"), androidBefore);
  assert.equal(readFileSync(iosPath, "utf8"), iosBefore);
});

test("validates every required set option before writing", () => {
  const root = copyFixtures("android-groovy", "ios-basic");
  const androidPath = join(root, "android", "app", "build.gradle");
  const iosPath = join(root, "ios", "Audit.xcodeproj", "project.pbxproj");
  const androidBefore = readFileSync(androidPath, "utf8");
  const iosBefore = readFileSync(iosPath, "utf8");
  const result = runCli([
    "set",
    "--platform",
    "all",
    "--root",
    root,
    "--app-version",
    "1.2.4",
    "--version-code",
    "42",
    "--non-interactive",
  ]);

  assert.equal(result.status, 2);
  assert.match(outputOf(result), /Missing required option --build-number/);
  assert.equal(readFileSync(androidPath, "utf8"), androidBefore);
  assert.equal(readFileSync(iosPath, "utf8"), iosBefore);
});

test("bumps both platforms and build numbers non-interactively", () => {
  const root = copyFixtures("android-groovy", "ios-basic");
  const result = runCli([
    "bump",
    "--platform",
    "all",
    "--root",
    root,
    "--release",
    "patch",
    "--increment-build",
    "--non-interactive",
  ]);

  assert.equal(result.status, 0);
  assert.match(outputOf(result), /bump: changed/);
  assert.match(
    readFileSync(join(root, "android", "app", "build.gradle"), "utf8"),
    /versionCode 42[\s\S]*versionName "1\.2\.4"/
  );
  assert.match(
    readFileSync(
      join(root, "ios", "Audit.xcodeproj", "project.pbxproj"),
      "utf8"
    ),
    /CURRENT_PROJECT_VERSION = 42;[\s\S]*MARKETING_VERSION = 1\.2\.4;/
  );
});

test("checks matching and divergent versions without writing", () => {
  const root = copyFixtures("android-groovy", "ios-basic");
  const androidPath = join(root, "android", "app", "build.gradle");
  const before = readFileSync(androidPath, "utf8");
  const matching = runCli([
    "check",
    "--platform",
    "all",
    "--root",
    root,
    "--app-version",
    "1.2.3",
    "--non-interactive",
  ]);
  const divergent = runCli([
    "check",
    "--platform",
    "android",
    "--root",
    root,
    "--version-name",
    "9.9.9",
    "--non-interactive",
  ]);

  assert.equal(matching.status, 0);
  assert.equal(divergent.status, 5);
  assert.match(outputOf(divergent), /CHECK_MISMATCH/);
  assert.equal(readFileSync(androidPath, "utf8"), before);
});

test("rejects an explicit project file outside --root", () => {
  const root = copyFixture("android-groovy");
  const outside = copyFixture("android-equals");
  const result = runCli([
    "inspect",
    "--platform",
    "android",
    "--root",
    root,
    "--android-file",
    join(outside, "android", "app", "build.gradle"),
    "--non-interactive",
  ]);

  assert.equal(result.status, 2);
  assert.match(outputOf(result), /must be inside the project root/);
});

test("emits a stable JSON schema 1 document for inspect", () => {
  const root = copyFixture("android-groovy");
  const result = runCli([
    "inspect",
    "--platform",
    "android",
    "--root",
    root,
    "--format",
    "json",
    "--no-color",
  ]);

  assert.equal(result.status, 0);
  assert.equal(result.stderr, "");
  assert.doesNotMatch(result.stdout, /\u001B\[/);
  assert.deepEqual(JSON.parse(result.stdout), {
    schemaVersion: 1,
    ok: true,
    command: "inspect",
    changed: false,
    dryRun: false,
    root: realpathSync(root),
    platforms: {
      android: {
        path: "android/app/build.gradle",
        before: { versionName: "1.2.3", versionCode: 41 },
        after: { versionName: "1.2.3", versionCode: 41 },
        matches: 2,
        matchCounts: { build: 1, marketing: 1, total: 2 },
      },
    },
    warnings: [],
  });
});

test("emits one JSON error document and the documented exit code", () => {
  const root = copyFixture("android-groovy");
  const result = runCli([
    "set",
    "--platform",
    "android",
    "--root",
    root,
    "--version-name",
    "1.2.4",
    "--format",
    "json",
  ]);

  assert.equal(result.status, 2);
  assert.equal(result.stderr, "");
  assert.deepEqual(JSON.parse(result.stdout), {
    schemaVersion: 1,
    ok: false,
    command: "set",
    error: {
      code: "VALIDATION_ERROR",
      message: "Missing required option --version-code.",
      hint: "Review the command help and provide every required option explicitly.",
      details: { path: "--version-code" },
    },
  });
});

test("prints actionable human errors without a stack unless debug is enabled", () => {
  const root = copyFixture("android-groovy");
  const args = [
    "set",
    "--platform",
    "android",
    "--root",
    root,
    "--version-name",
    "1.2.4",
  ];
  const normal = runCli(args);
  const debug = runCli([...args, "--debug"]);

  assert.equal(normal.status, 2);
  assert.match(normal.stderr, /VALIDATION_ERROR:/);
  assert.match(normal.stderr, /Hint: Review the command help/);
  assert.doesNotMatch(normal.stderr, /BumpVersionError:/);
  assert.equal(debug.status, 2);
  assert.match(debug.stderr, /BumpVersionError:/);
});

test("writes the same JSON result to --output-file", () => {
  const root = copyFixture("android-groovy");
  const outputFile = join(root, "bump-result.json");
  const result = runCli([
    "inspect",
    "--platform",
    "android",
    "--root",
    root,
    "--format",
    "json",
    "--output-file",
    "bump-result.json",
  ]);

  assert.equal(result.status, 0);
  assert.deepEqual(
    JSON.parse(readFileSync(outputFile, "utf8")),
    JSON.parse(result.stdout)
  );
  if (process.platform !== "win32") {
    assert.equal(statSync(outputFile).mode & 0o777, 0o600);
  }
});

test("returns JSON CHECK_MISMATCH with exit 5", () => {
  const root = copyFixture("android-groovy");
  const result = runCli([
    "check",
    "--platform",
    "android",
    "--root",
    root,
    "--version-name",
    "9.9.9",
    "--format",
    "json",
    "--quiet",
  ]);
  const document = JSON.parse(result.stdout);

  assert.equal(result.status, 5);
  assert.equal(result.stderr, "");
  assert.equal(document.schemaVersion, 1);
  assert.equal(document.ok, false);
  assert.equal(document.error.code, "CHECK_MISMATCH");
  assert.deepEqual(document.error.details.expected, "9.9.9");
  assert.deepEqual(document.error.details.actual, "1.2.3");
});

test("keeps JSON dry-run and the project bytes consistent", () => {
  const root = copyFixtures("android-groovy", "ios-basic");
  const androidPath = join(root, "android", "app", "build.gradle");
  const iosPath = join(root, "ios", "Audit.xcodeproj", "project.pbxproj");
  const androidBefore = readFileSync(androidPath, "utf8");
  const iosBefore = readFileSync(iosPath, "utf8");
  const result = runCli([
    "set",
    "--platform",
    "all",
    "--root",
    root,
    "--app-version",
    "1.2.4",
    "--version-code",
    "42",
    "--build-number",
    "42",
    "--dry-run",
    "--format",
    "json",
  ]);
  const document = JSON.parse(result.stdout);

  assert.equal(result.status, 0);
  assert.equal(document.ok, true);
  assert.equal(document.changed, true);
  assert.equal(document.dryRun, true);
  assert.equal(readFileSync(androidPath, "utf8"), androidBefore);
  assert.equal(readFileSync(iosPath, "utf8"), iosBefore);
});

test("returns a JSON usage error for an unknown automation option", () => {
  const root = copyFixture("android-groovy");
  const result = runCli([
    "inspect",
    "--platform",
    "android",
    "--root",
    root,
    "--format",
    "json",
    "--unknown-option",
  ]);
  const document = JSON.parse(result.stdout);

  assert.equal(result.status, 2);
  assert.equal(result.stderr, "");
  assert.equal(document.ok, false);
  assert.equal(document.error.code, "VALIDATION_ERROR");
  assert.match(document.error.message, /unknown option/);
});

test("fails a legacy interactive command immediately in CI", () => {
  const root = copyFixture("android-groovy");
  const result = runCli(["android"], {
    cwd: root,
    env: { CI: "true" },
  });
  const output = outputOf(result);

  assert.equal(result.status, 2);
  assert.match(output, /Interactive legacy commands are disabled/);
  assert.doesNotMatch(output, /created by:/);
  assert.doesNotMatch(output, /Enter the new Version/);
});

test("returns JSON WRITE_ERROR with exit 6 when commit is denied", {
  skip: process.platform === "win32",
}, () => {
  const root = copyFixture("android-groovy");
  const projectPath = join(root, "android", "app", "build.gradle");
  const directory = dirname(projectPath);
  const directoryMode = statSync(directory).mode & 0o777;
  const before = readFileSync(projectPath, "utf8");
  let result;

  chmodSync(directory, 0o500);

  try {
    result = runCli([
      "set",
      "--platform",
      "android",
      "--root",
      root,
      "--version-name",
      "1.2.4",
      "--version-code",
      "42",
      "--format",
      "json",
    ]);
  } finally {
    chmodSync(directory, directoryMode);
  }

  const document = JSON.parse(result.stdout);
  assert.equal(result.status, 6);
  assert.equal(result.stderr, "");
  assert.equal(document.ok, false);
  assert.equal(document.error.code, "WRITE_ERROR");
  assert.equal(readFileSync(projectPath, "utf8"), before);
});

test("loads .bump-version.json and lets flags override config values", () => {
  const root = copyFixture("android-groovy");
  const projectPath = join(root, "android", "app", "build.gradle");
  writeFileSync(
    join(root, ".bump-version.json"),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        platform: "android",
        android: {
          versionName: "1.2.4",
          versionCode: 40,
        },
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  const result = runCli([
    "set",
    "--root",
    root,
    "--version-code",
    "42",
    "--non-interactive",
    "--format",
    "json",
  ]);
  const document = JSON.parse(result.stdout);
  const project = readFileSync(projectPath, "utf8");

  assert.equal(result.status, 0);
  assert.equal(document.ok, true);
  assert.equal(document.platforms.android.after.versionName, "1.2.4");
  assert.equal(document.platforms.android.after.versionCode, 42);
  assert.match(project, /versionCode 42\b/);
  assert.match(project, /versionName "1\.2\.4"/);
});

test("loads iOS target and configuration selection from config", () => {
  const root = copyFixture("ios-targets");
  const projectPath = join(
    root,
    "ios",
    "Targets.xcodeproj",
    "project.pbxproj"
  );
  writeFileSync(
    join(root, ".bump-version.json"),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        platform: "ios",
        ios: {
          project: "Targets",
          target: "App",
          configuration: "Release",
          marketingVersion: "1.3.0",
          buildNumber: 43,
        },
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  const result = runCli([
    "set",
    "--root",
    root,
    "--format",
    "json",
  ]);
  const document = JSON.parse(result.stdout);
  const project = readFileSync(projectPath, "utf8");

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.deepEqual(document.platforms.ios.selection, {
    target: "App",
    configuration: "Release",
  });
  assert.equal((project.match(/CURRENT_PROJECT_VERSION = "43";/g) ?? []).length, 1);
  assert.equal((project.match(/CURRENT_PROJECT_VERSION = 41;/g) ?? []).length, 1);
});

test("rejects an invalid automation config before writing", () => {
  const root = copyFixture("android-groovy");
  const projectPath = join(root, "android", "app", "build.gradle");
  const before = readFileSync(projectPath, "utf8");
  writeFileSync(
    join(root, "custom-bump.json"),
    '{"schemaVersion":1,"unknownOption":true}\n',
    "utf8"
  );
  const result = runCli([
    "set",
    "--root",
    root,
    "--config",
    "custom-bump.json",
    "--format",
    "json",
  ]);
  const document = JSON.parse(result.stdout);

  assert.equal(result.status, 4);
  assert.equal(document.ok, false);
  assert.equal(document.error.code, "PARSE_ERROR");
  assert.match(document.error.message, /unknown keys/);
  assert.equal(readFileSync(projectPath, "utf8"), before);
});
