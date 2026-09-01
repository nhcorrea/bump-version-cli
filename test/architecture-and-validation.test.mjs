import assert from "node:assert/strict";
import {
  chmodSync,
  cpSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  lstatSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  describeSpawnFailure,
  resolveCommandInvocation,
} from "../scripts/spawn-command.mjs";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(testDirectory, "..");
const compiledCliPath = join(repositoryRoot, "dist", "cli.js");
const require = createRequire(import.meta.url);
const {
  MAX_ANDROID_VERSION_CODE,
  validateAndroidVersionCode,
} = require(join(repositoryRoot, "dist", "core", "version.js"));
const {
  applyAndroidChangePlan,
  createAndroidChangePlan,
  parseAndroidBuildGradle,
  transformAndroidBuildGradle,
} = require(join(repositoryRoot, "dist", "lib", "android.js"));
const {
  createIOSChangePlan,
  parseIOSConfig,
  transformIOSConfig,
} = require(
  join(repositoryRoot, "dist", "lib", "ios.js")
);
const { commitChangePlans } = require(
  join(repositoryRoot, "dist", "lib", "safe-write.js")
);
const { createProgram } = require(compiledCliPath);

test("routes Windows command shims through cmd.exe", () => {
  assert.deepEqual(
    resolveCommandInvocation("yarn.cmd", ["--version"], {
      platform: "win32",
      commandShell: "C:\\Windows\\System32\\cmd.exe",
    }),
    {
      command: "C:\\Windows\\System32\\cmd.exe",
      args: ["/d", "/c", "yarn.cmd", "--version"],
      usesCommandShell: true,
    }
  );
});

test("keeps native commands direct and reports spawn errors", () => {
  assert.deepEqual(
    resolveCommandInvocation("node", ["--version"], { platform: "linux" }),
    {
      command: "node",
      args: ["--version"],
      usesCommandShell: false,
    }
  );
  assert.equal(
    describeSpawnFailure({
      error: new Error("spawn EINVAL"),
      status: null,
      signal: null,
    }),
    "spawn EINVAL"
  );
});

function copyMobileFixtures(prefix) {
  const root = mkdtempSync(join(tmpdir(), prefix));
  cpSync(
    join(repositoryRoot, "test", "fixtures", "android-groovy"),
    root,
    { recursive: true }
  );
  cpSync(join(repositoryRoot, "test", "fixtures", "ios-basic"), root, {
    recursive: true,
  });
  return root;
}

test("exports createProgram without executing the CLI on import", () => {
  const script = [
    `const cli = require(${JSON.stringify(compiledCliPath)});`,
    'if (typeof cli.createProgram !== "function") process.exit(2);',
    'if (cli.createProgram().name() !== "bump-version") process.exit(3);',
  ].join(" ");
  const result = spawnSync(process.execPath, ["-e", script], {
    cwd: repositoryRoot,
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "");
});

test("maps an unexpected automation failure to JSON exit code 70", () => {
  const logs = [];
  const errors = [];
  let exitCode = 0;
  const program = createProgram({
    cwd: () => {
      throw new Error("simulated internal failure");
    },
    input: process.stdin,
    output: process.stdout,
    log: (message = "") => logs.push(message),
    error: (message) => errors.push(message),
    clear: () => undefined,
    setExitCode: (code) => {
      exitCode = code;
    },
  });

  program.parse(["node", "cli", "inspect", "--format", "json"]);

  assert.equal(exitCode, 70);
  assert.equal(errors.length, 0);
  assert.equal(logs.length, 1);
  assert.deepEqual(JSON.parse(logs[0]), {
    schemaVersion: 1,
    ok: false,
    command: "inspect",
    error: {
      code: "INTERNAL_ERROR",
      message: "simulated internal failure",
      hint: "Re-run with --debug and inspect the stack trace before retrying.",
      details: {},
    },
  });
});

test("validates Android versionCode boundaries and normalizes digits", () => {
  assert.equal(validateAndroidVersionCode("00042", "41"), "42");
  assert.equal(
    validateAndroidVersionCode(String(MAX_ANDROID_VERSION_CODE), "41"),
    String(MAX_ANDROID_VERSION_CODE)
  );

  for (const value of ["0", "-1", "1.5", "1e3", "2100000001"]) {
    assert.throws(
      () => validateAndroidVersionCode(value, "41"),
      (error) => error.code === "VALIDATION_ERROR"
    );
  }
});

test("blocks Android versionCode downgrade unless explicitly allowed", () => {
  assert.throws(
    () => validateAndroidVersionCode("40", "41"),
    (error) =>
      error.code === "VERSION_CONFLICT" &&
      error.message.includes("--allow-downgrade")
  );
  assert.equal(validateAndroidVersionCode("40", "41", true), "40");
});

test("parses and transforms Android content using an injected path", () => {
  const fixturePath = join(
    repositoryRoot,
    "test",
    "fixtures",
    "android-equals",
    "android",
    "app",
    "build.gradle"
  );
  const source = readFileSync(fixturePath, "utf8");
  const virtualPath = "/virtual/project/android/app/build.gradle";
  const parsed = parseAndroidBuildGradle(source, virtualPath);

  assert.deepEqual(parsed, {
    buildVersion: "41",
    marketingVersion: "1.2.3",
  });
  assert.throws(
    () => transformAndroidBuildGradle(source, virtualPath, "40", "1.2.4"),
    (error) =>
      error.code === "VERSION_CONFLICT" && error.path === "versionCode"
  );

  const transformed = transformAndroidBuildGradle(
    source,
    virtualPath,
    "40",
    "1.2.4",
    { allowDowngrade: true }
  );

  assert.match(transformed, /versionCode = 40\b/);
  assert.match(transformed, /versionName = "1\.2\.4"/);
});

test("preserves iOS whitespace, CRLF and unrelated content", () => {
  const path = "/virtual/project/ios/App.xcodeproj/project.pbxproj";
  const source = [
    "// !$*UTF8*$!",
    "{",
    "\tbuildSettings = {",
    "\t\tOTHER_SETTING = untouched;",
    "\t\tCURRENT_PROJECT_VERSION  =  41  ;",
    "\t\tMARKETING_VERSION = 1.2.3;",
    "\t};",
    "}",
    "",
  ].join("\r\n");
  const transformed = transformIOSConfig(source, path, "42", "1.2.4");

  assert.equal(
    transformed,
    source
      .replace("CURRENT_PROJECT_VERSION  =  41  ;", "CURRENT_PROJECT_VERSION  =  42  ;")
      .replace("MARKETING_VERSION = 1.2.3;", "MARKETING_VERSION = 1.2.4;")
  );
  assert.match(transformed, /OTHER_SETTING = untouched;/);
  assert.equal(transformed.split("\r\n").length, source.split("\r\n").length);
});

test("creates a deterministic Android ChangePlan with hashes and match counts", () => {
  const fixturePath = join(
    repositoryRoot,
    "test",
    "fixtures",
    "android-groovy",
    "android",
    "app",
    "build.gradle"
  );
  const first = createAndroidChangePlan(fixturePath, "42", "1.2.4");
  const second = createAndroidChangePlan(fixturePath, "42", "1.2.4");

  assert.deepEqual(first, second);
  assert.equal(first.platform, "android");
  assert.deepEqual(first.matches, { build: 1, marketing: 1, total: 2 });
  assert.match(first.beforeHash, /^[a-f0-9]{64}$/);
  assert.match(first.afterHash, /^[a-f0-9]{64}$/);
  assert.notEqual(first.beforeHash, first.afterHash);
  assert.equal(first.changed, true);
  assert.deepEqual(first.before, {
    buildVersion: "41",
    marketingVersion: "1.2.3",
  });
  assert.deepEqual(first.after, {
    buildVersion: "42",
    marketingVersion: "1.2.4",
  });
});

test("applies an Android no-op without changing bytes or mtime", () => {
  const root = mkdtempSync(join(tmpdir(), "bump-version-noop-"));
  cpSync(
    join(repositoryRoot, "test", "fixtures", "android-groovy"),
    root,
    { recursive: true }
  );
  const path = join(root, "android", "app", "build.gradle");
  const beforeContent = readFileSync(path, "utf8");
  const beforeStat = statSync(path, { bigint: true });
  const plan = createAndroidChangePlan(path, "41", "1.2.3");
  const applied = applyAndroidChangePlan(plan);
  const afterStat = statSync(path, { bigint: true });

  assert.equal(plan.changed, false);
  assert.equal(plan.beforeHash, plan.afterHash);
  assert.equal(applied.changed, false);
  assert.equal(readFileSync(path, "utf8"), beforeContent);
  assert.equal(afterStat.mtimeNs, beforeStat.mtimeNs);
});

test("commits atomically, preserves mode and removes temporary files", {
  skip: process.platform === "win32",
}, () => {
  const root = mkdtempSync(join(tmpdir(), "bump-version-atomic-"));
  cpSync(
    join(repositoryRoot, "test", "fixtures", "android-groovy"),
    root,
    { recursive: true }
  );
  const path = join(root, "android", "app", "build.gradle");
  const directory = dirname(path);
  chmodSync(path, 0o640);
  const plan = createAndroidChangePlan(path, "42", "1.2.4");
  const applied = applyAndroidChangePlan(plan);

  assert.equal(applied.changed, true);
  assert.equal(statSync(path).mode & 0o777, 0o640);
  assert.match(readFileSync(path, "utf8"), /versionCode 42\b/);
  assert.deepEqual(
    readdirSync(directory).filter((name) => name.includes(".bump-version-")),
    []
  );
});

test("rejects a stale plan without overwriting a concurrent change", () => {
  const root = mkdtempSync(join(tmpdir(), "bump-version-concurrent-"));
  cpSync(
    join(repositoryRoot, "test", "fixtures", "android-groovy"),
    root,
    { recursive: true }
  );
  const path = join(root, "android", "app", "build.gradle");
  const directory = dirname(path);
  const plan = createAndroidChangePlan(path, "42", "1.2.4");
  const concurrentContent = `${readFileSync(path, "utf8")}\n// concurrent edit\n`;
  writeFileSync(path, concurrentContent, "utf8");

  assert.throws(
    () => applyAndroidChangePlan(plan),
    (error) => error.code === "CONCURRENT_MODIFICATION"
  );
  assert.equal(readFileSync(path, "utf8"), concurrentContent);
  assert.deepEqual(
    readdirSync(directory).filter((name) => name.includes(".bump-version-")),
    []
  );
});

test("rejects a symbolic-link target instead of replacing the link", {
  skip: process.platform === "win32",
}, () => {
  const root = mkdtempSync(join(tmpdir(), "bump-version-symlink-"));
  const realPath = join(root, "real.gradle");
  const linkPath = join(root, "build.gradle");
  const source = readFileSync(
    join(
      repositoryRoot,
      "test",
      "fixtures",
      "android-groovy",
      "android",
      "app",
      "build.gradle"
    ),
    "utf8"
  );
  writeFileSync(realPath, source, "utf8");
  symlinkSync(realPath, linkPath);
  const plan = createAndroidChangePlan(linkPath, "42", "1.2.4");

  assert.throws(
    () => applyAndroidChangePlan(plan),
    (error) => error.code === "WRITE_ERROR"
  );
  assert.equal(lstatSync(linkPath).isSymbolicLink(), true);
  assert.equal(readFileSync(realPath, "utf8"), source);
});

test("keeps the original when the target directory is not writable", {
  skip: process.platform === "win32",
}, () => {
  const root = mkdtempSync(join(tmpdir(), "bump-version-permission-"));
  cpSync(
    join(repositoryRoot, "test", "fixtures", "android-groovy"),
    root,
    { recursive: true }
  );
  const path = join(root, "android", "app", "build.gradle");
  const directory = dirname(path);
  const before = readFileSync(path, "utf8");
  const directoryMode = statSync(directory).mode & 0o777;
  const plan = createAndroidChangePlan(path, "42", "1.2.4");

  chmodSync(directory, 0o500);

  try {
    assert.throws(
      () => applyAndroidChangePlan(plan),
      (error) => error.code === "WRITE_ERROR"
    );
  } finally {
    chmodSync(directory, directoryMode);
  }

  assert.equal(readFileSync(path, "utf8"), before);
  assert.deepEqual(
    readdirSync(directory).filter((name) => name.includes(".bump-version-")),
    []
  );
});

test("preflights every target before a multi-file commit", () => {
  const root = copyMobileFixtures("bump-version-preflight-");
  const androidPath = join(root, "android", "app", "build.gradle");
  const iosPath = join(root, "ios", "Audit.xcodeproj", "project.pbxproj");
  const androidBefore = readFileSync(androidPath, "utf8");
  const androidPlan = createAndroidChangePlan(
    androidPath,
    "42",
    "1.2.4"
  );
  const iosPlan = createIOSChangePlan(iosPath, "42", "1.2.4");
  writeFileSync(iosPath, `${readFileSync(iosPath, "utf8")}\n// concurrent\n`);

  assert.throws(
    () =>
      commitChangePlans([
        { plan: androidPlan, parseConfig: parseAndroidBuildGradle },
        { plan: iosPlan, parseConfig: parseIOSConfig },
      ]),
    (error) => error.code === "CONCURRENT_MODIFICATION"
  );
  assert.equal(readFileSync(androidPath, "utf8"), androidBefore);
});

test("rolls back an earlier target when a later commit fails", {
  skip: process.platform === "win32",
}, () => {
  const root = copyMobileFixtures("bump-version-rollback-");
  const androidPath = join(root, "android", "app", "build.gradle");
  const iosPath = join(root, "ios", "Audit.xcodeproj", "project.pbxproj");
  const iosDirectory = dirname(iosPath);
  const androidBefore = readFileSync(androidPath, "utf8");
  const iosBefore = readFileSync(iosPath, "utf8");
  const iosDirectoryMode = statSync(iosDirectory).mode & 0o777;
  const androidPlan = createAndroidChangePlan(
    androidPath,
    "42",
    "1.2.4"
  );
  const iosPlan = createIOSChangePlan(iosPath, "42", "1.2.4");

  chmodSync(iosDirectory, 0o500);

  try {
    assert.throws(
      () =>
        commitChangePlans([
          { plan: androidPlan, parseConfig: parseAndroidBuildGradle },
          { plan: iosPlan, parseConfig: parseIOSConfig },
        ]),
      (error) => error.code === "WRITE_ERROR"
    );
  } finally {
    chmodSync(iosDirectory, iosDirectoryMode);
  }

  assert.equal(readFileSync(androidPath, "utf8"), androidBefore);
  assert.equal(readFileSync(iosPath, "utf8"), iosBefore);
  assert.deepEqual(
    readdirSync(dirname(androidPath)).filter((name) =>
      name.includes(".bump-version-")
    ),
    []
  );
  assert.deepEqual(
    readdirSync(iosDirectory).filter((name) =>
      name.includes(".bump-version-")
    ),
    []
  );
});

test("reports ROLLBACK_ERROR when a multi-file restore also fails", {
  skip: process.platform === "win32",
}, () => {
  const root = copyMobileFixtures("bump-version-rollback-error-");
  const androidPath = join(root, "android", "app", "build.gradle");
  const iosPath = join(root, "ios", "Audit.xcodeproj", "project.pbxproj");
  const androidDirectory = dirname(androidPath);
  const androidDirectoryMode = statSync(androidDirectory).mode & 0o777;
  const androidPlan = createAndroidChangePlan(
    androidPath,
    "42",
    "1.2.4"
  );
  const iosPlan = createIOSChangePlan(iosPath, "42", "1.2.4");
  let caught;

  try {
    commitChangePlans([
      { plan: androidPlan, parseConfig: parseAndroidBuildGradle },
      {
        plan: iosPlan,
        parseConfig: () => {
          chmodSync(androidDirectory, 0o500);
          throw new Error("simulated verification failure");
        },
      },
    ]);
  } catch (error) {
    caught = error;
  } finally {
    chmodSync(androidDirectory, androidDirectoryMode);
  }

  assert.equal(caught?.code, "ROLLBACK_ERROR");
  assert.match(readFileSync(androidPath, "utf8"), /versionCode 42\b/);
  assert.match(readFileSync(iosPath, "utf8"), /CURRENT_PROJECT_VERSION = 41;/);
});
