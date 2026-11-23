import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(testDirectory, "..");
const fixturesRoot = join(testDirectory, "fixtures");
const require = createRequire(import.meta.url);
const core = require(join(repositoryRoot, "dist", "core.cjs"));
const cli = require(join(repositoryRoot, "dist", "package", "cli.js"));

const ANDROID = fs.readFileSync(
  join(fixturesRoot, "android-groovy", "android", "app", "build.gradle"),
  "utf8",
);
const ANDROID_EQUALS = fs.readFileSync(
  join(fixturesRoot, "android-equals", "android", "app", "build.gradle"),
  "utf8",
);
const IOS = fs.readFileSync(
  join(fixturesRoot, "ios-basic", "ios", "Audit.xcodeproj", "project.pbxproj"),
  "utf8",
);
const GRAPH = fs.readFileSync(
  join(
    fixturesRoot,
    "ios-targets",
    "ios",
    "Targets.xcodeproj",
    "project.pbxproj",
  ),
  "utf8",
);

function setup(t) {
  const temp = fs.mkdtempSync(join(tmpdir(), "bump-core-test-"));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const root = fs.realpathSync(temp);
  const androidPath = join(root, "android", "app", "build.gradle");
  const iosPath = join(root, "ios", "Audit.xcodeproj", "project.pbxproj");
  for (const [filePath, contents] of [
    [androidPath, ANDROID],
    [iosPath, IOS],
  ]) {
    fs.mkdirSync(dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, contents, "utf8");
  }
  return { root, androidPath, iosPath };
}

function makePlan(platform, filePath, build, marketing, allowDowngrade) {
  const text = fs.readFileSync(filePath, "utf8");
  const selection = { allTargets: false };
  const source = core.analyzePlatform(platform, text, filePath, selection);
  return core.createPlan(
    platform,
    filePath,
    selection,
    text,
    source,
    { build, marketing },
    allowDowngrade,
  );
}

function assertNoTempFiles(filePath) {
  const entries = fs.readdirSync(dirname(filePath));
  assert.ok(
    entries.every((name) => !name.includes(".bump-version-")),
    `Leftover temporary files in ${dirname(filePath)}: ${entries.join(", ")}`,
  );
}

function assertBumpError(fn, expectedCode) {
  let caught;
  try {
    fn();
  } catch (error) {
    caught = error;
  }
  assert.ok(core.isBumpVersionError(caught), `Expected BumpVersionError, got ${caught}`);
  assert.equal(caught.code, expectedCode);
  return caught;
}

test("validates, normalizes, and checks Android versionCode downgrade", () => {
  assert.equal(core.validateAndroidVersionCode("00042", "41", false), 42);
  for (const value of [1, 2_100_000_000]) {
    assert.equal(
      core.validateAndroidVersionCode(String(value), undefined, false),
      value,
    );
  }
  for (const invalid of ["0", "-1", "1.5", "1e3", "2100000001"]) {
    assertBumpError(
      () => core.validateAndroidVersionCode(invalid, undefined, false),
      "VALIDATION_ERROR",
    );
  }
  const downgradeError = assertBumpError(
    () => core.validateAndroidVersionCode("40", "41", false),
    "VERSION_CONFLICT",
  );
  assert.equal(downgradeError.path, "versionCode");
  assert.match(downgradeError.message, /--allow-downgrade/);
  assert.equal(core.validateAndroidVersionCode("40", "41", true), 40);
});

test("supports virtual Android paths and produces exact replacements", () => {
  const virtualPath = "/virtual/app/build.gradle";
  const selection = { allTargets: false };
  const build = (allowDowngrade) =>
    core.createPlan(
      "android",
      virtualPath,
      selection,
      ANDROID_EQUALS,
      core.analyzePlatform("android", ANDROID_EQUALS, virtualPath, selection),
      { build: "40", marketing: "1.2.4" },
      allowDowngrade,
    );

  assertBumpError(() => build(false), "VERSION_CONFLICT");
  const plan = build(true);
  assert.deepEqual(plan.original, { build: "41", marketing: "1.2.3" });
  assert.equal(
    plan.after,
    ANDROID_EQUALS.replace("41", "40").replace("1.2.3", "1.2.4"),
  );
});

test("preserves iOS CRLF, comments, spacing, and selected target/configuration ranges", () => {
  const text = GRAPH.replaceAll(
    "CURRENT_PROJECT_VERSION =",
    "CURRENT_PROJECT_VERSION  =  ",
  ).replaceAll("\n", "\r\n");
  const selection = {
    target: "App",
    configuration: "Release",
    allTargets: false,
  };

  assertBumpError(
    () => core.analyzePlatform("ios", text, "p", { allTargets: false }),
    "AMBIGUOUS",
  );

  const source = core.analyzePlatform("ios", text, "p", selection);
  const plan = core.createPlan(
    "ios",
    "p",
    selection,
    text,
    source,
    { build: "42", marketing: "1.2.4" },
    false,
  );
  assert.equal(
    plan.after,
    text.replace('"41"', '"42"').replace('"1.2.3"', '"1.2.4"'),
  );
});

test("computes deterministic SHA-256 plan hashes, match counts, and idempotent no-op", (t) => {
  const { androidPath } = setup(t);
  const make = () => makePlan("android", androidPath, "42", "1.2.4", false);
  const plan = make();
  assert.deepEqual(core.planHashes(plan), core.planHashes(make()));

  const [beforeHash, afterHash] = core.planHashes(plan);
  assert.notEqual(beforeHash, afterHash);
  for (const hash of [beforeHash, afterHash]) {
    assert.match(hash, /^[0-9a-f]{64}$/);
  }
  assert.deepEqual(core.planMatches(plan), {
    build: 1,
    marketing: 1,
    total: 2,
  });
  assert.equal(core.planChanged(plan), true);

  const same = makePlan("android", androidPath, "41", "1.2.3", false);
  assert.equal(core.planChanged(same), false);
  const [sameBefore, sameAfter] = core.planHashes(same);
  assert.equal(sameBefore, sameAfter);

  const mtimeBefore = fs.statSync(androidPath).mtimeMs;
  core.commitPlans(core.nodeHost, [same]);
  assert.equal(fs.statSync(androidPath).mtimeMs, mtimeBefore);
  assert.equal(fs.readFileSync(androidPath, "utf8"), ANDROID);
});

test("rejects stale single and multi-file plans on preflight without overwriting", (t) => {
  const { androidPath, iosPath } = setup(t);
  const androidPlan = makePlan("android", androidPath, "42", "1.2.4", false);
  const iosPlan = makePlan("ios", iosPath, "42", "1.2.4", false);

  fs.writeFileSync(iosPath, `${IOS}// changed`, "utf8");
  assertBumpError(
    () => core.commitPlans(core.nodeHost, [androidPlan, iosPlan]),
    "CONCURRENT_MODIFICATION",
  );
  assert.equal(fs.readFileSync(androidPath, "utf8"), ANDROID);

  const singlePlan = makePlan("android", androidPath, "42", "1.2.4", false);
  const changed = `${ANDROID}// changed`;
  fs.writeFileSync(androidPath, changed, "utf8");
  assertBumpError(
    () => core.commitPlans(core.nodeHost, [singlePlan]),
    "CONCURRENT_MODIFICATION",
  );
  assert.equal(fs.readFileSync(androidPath, "utf8"), changed);
  assertNoTempFiles(androidPath);
  assertNoTempFiles(iosPath);
});

test(
  "preserves POSIX mode, replaces inode atomically, and rejects symlinks",
  { skip: process.platform === "win32" },
  (t) => {
    const { root, androidPath } = setup(t);
    const linkPath = join(root, "link.gradle");
    fs.symlinkSync(androidPath, linkPath);

    const linkPlan = makePlan("android", linkPath, "42", "1.2.4", false);
    assertBumpError(
      () => core.commitPlans(core.nodeHost, [linkPlan]),
      "WRITE_ERROR",
    );
    assert.equal(fs.lstatSync(linkPath).isSymbolicLink(), true);
    assert.equal(fs.readFileSync(androidPath, "utf8"), ANDROID);

    fs.chmodSync(androidPath, 0o640);
    const oldIno = fs.statSync(androidPath).ino;
    const plan = makePlan("android", androidPath, "42", "1.2.4", false);
    core.commitPlans(core.nodeHost, [plan]);
    const nextStat = fs.statSync(androidPath);
    assert.notEqual(oldIno, nextStat.ino);
    assert.equal(nextStat.mode & 0o777, 0o640);
    assert.match(fs.readFileSync(androidPath, "utf8"), /versionCode 42/);
    assertNoTempFiles(androidPath);
  },
);

test("restores second and first files on commit or verification failure", (t) => {
  for (const [failVerification, failRestore, expectedCode] of [
    [false, false, "WRITE_ERROR"],
    [true, false, "VERIFY_ERROR"],
    [true, true, "ROLLBACK_ERROR"],
  ]) {
    const { androidPath, iosPath } = setup(t);
    const androidPlan = makePlan("android", androidPath, "42", "1.2.4", false);
    const iosPlan = makePlan("ios", iosPath, "42", "1.2.4", false);
    let renamedSecond = false;
    let failed = false;

    const faultHost = {
      ...core.nodeHost,
      rename(from, to) {
        if (to === iosPath) {
          if (!failVerification) {
            throw new Error("second rename denied");
          }
          renamedSecond = true;
        }
        return core.nodeHost.rename(from, to);
      },
      read(filePath) {
        if (filePath === iosPath && renamedSecond && !failed) {
          failed = true;
          throw new Error("injected verification read failure");
        }
        return core.nodeHost.read(filePath);
      },
      stage(destination, contents) {
        if (failed && destination !== iosPath && failRestore) {
          throw new Error("first restore denied");
        }
        return core.nodeHost.stage(destination, contents);
      },
    };

    assertBumpError(
      () => core.commitPlans(faultHost, [androidPlan, iosPlan]),
      expectedCode,
    );
    assert.equal(fs.readFileSync(iosPath, "utf8"), IOS);
    const actualAndroid = fs.readFileSync(androidPath, "utf8");
    if (failRestore) {
      assert.match(actualAndroid, /versionCode 42/);
    } else {
      assert.equal(actualAndroid, ANDROID);
    }
    assertNoTempFiles(androidPath);
    assertNoTempFiles(iosPath);
  }
});

test(
  "confines input and output symlinks inside root before writes",
  { skip: process.platform === "win32" },
  (t) => {
    const { root, androidPath } = setup(t);
    const outside = fs.mkdtempSync(join(tmpdir(), "bump-outside-"));
    t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
    const external = join(outside, "gradle");
    fs.writeFileSync(external, ANDROID, "utf8");
    fs.symlinkSync(external, join(root, "link"));
    fs.symlinkSync(outside, join(root, "escape"));

    for (const override of [
      { androidFile: "link" },
      { outputFile: "escape/result.json" },
      { outputFile: "link" },
      { outputFile: "android/app/build.gradle" },
    ]) {
      assertBumpError(
        () =>
          core.runAutomation(
            core.nodeHost,
            "set",
            {
              platform: "android",
              appVersion: "1.2.4",
              versionCode: "42",
              ...override,
            },
            root,
          ),
        "VALIDATION_ERROR",
      );
      assert.equal(fs.readFileSync(androidPath, "utf8"), ANDROID);
    }

    assertBumpError(
      () => core.resolveOutputPath(core.nodeHost, root, "../outside"),
      "VALIDATION_ERROR",
    );
    assert.equal(fs.readFileSync(external, "utf8"), ANDROID);
  },
);

test("matches dry-run with real multi-platform commit and rejects invalid config", (t) => {
  const { root, androidPath, iosPath } = setup(t);
  const configPath = join(root, ".bump-version.json");
  const opts = {
    appVersion: "1.2.4",
    versionCode: "00042",
    buildNumber: "42",
    dryRun: true,
  };

  fs.writeFileSync(
    configPath,
    '{"schemaVersion":1,"unexpected":true}',
    "utf8",
  );
  assertBumpError(
    () => core.runAutomation(core.nodeHost, "set", opts, root),
    "PARSE_ERROR",
  );

  fs.writeFileSync(
    configPath,
    '{"android":{"versionName":"1.3.0","versionCode":4}}',
    "utf8",
  );
  const dry = core.runAutomation(core.nodeHost, "set", opts, root);
  assert.equal(fs.readFileSync(androidPath, "utf8"), ANDROID);
  assert.equal(fs.readFileSync(iosPath, "utf8"), IOS);

  const applied = core.runAutomation(
    core.nodeHost,
    "set",
    { ...opts, dryRun: false },
    root,
  );
  assert.deepEqual(dry.platforms, applied.platforms);
  assert.deepEqual(applied.platforms.android.after, {
    versionName: "1.3.0",
    versionCode: 42,
  });
});

test(
  "keeps original file and cleans temps when directory is unwritable",
  { skip: process.platform === "win32" },
  (t) => {
    const { androidPath } = setup(t);
    const plan = makePlan("android", androidPath, "42", "1.2.4", false);
    const dir = dirname(androidPath);
    const oldMode = fs.statSync(dir).mode & 0o777;
    fs.chmodSync(dir, 0o500);
    try {
      assertBumpError(
        () => core.commitPlans(core.nodeHost, [plan]),
        "WRITE_ERROR",
      );
    } finally {
      fs.chmodSync(dir, oldMode);
    }
    assert.equal(fs.readFileSync(androidPath, "utf8"), ANDROID);
    assertNoTempFiles(androidPath);
  },
);

test("preserves concurrent edits made while staging and removes temporary file", (t) => {
  const { androidPath } = setup(t);
  const plan = makePlan("android", androidPath, "42", "1.2.4", false);
  const editAfterStageHost = {
    ...core.nodeHost,
    stage(destination, contents) {
      const staged = core.nodeHost.stage(destination, contents);
      fs.writeFileSync(destination, "concurrent edit", "utf8");
      return staged;
    },
  };

  assertBumpError(
    () => core.commitPlans(editAfterStageHost, [plan]),
    "CONCURRENT_MODIFICATION",
  );
  assert.equal(fs.readFileSync(androidPath, "utf8"), "concurrent edit");
  assertNoTempFiles(androidPath);
});

test("parses CLI help, short flags, and usage errors without third-party runtime parsers", () => {
  function invoke(args) {
    const stdout = [];
    const stderr = [];
    let exitCode = 0;
    cli
      .createProgram({
        cwd: () => repositoryRoot,
        log: (line = "") => stdout.push(line),
        error: (line = "") => stderr.push(line),
        setExitCode: (code) => {
          exitCode = code;
        },
      })
      .parse(args, { from: "user" });
    return { exitCode, stdout: stdout.join("\n"), stderr: stderr.join("\n") };
  }

  const shortVersion = invoke(["-V"]);
  assert.equal(shortVersion.exitCode, 0);
  assert.match(shortVersion.stdout, /^\d+\.\d+\.\d+$/);

  const helpCmd = invoke(["help", "bump"]);
  assert.equal(helpCmd.exitCode, 0);
  assert.match(helpCmd.stdout, /--release <type>/);
  assert.match(helpCmd.stdout, /--increment-build/);

  const missingOptionArg = invoke(["inspect", "--format=json", "--platform"]);
  assert.equal(missingOptionArg.exitCode, 2);
  assert.equal(missingOptionArg.stderr, "");
  assert.equal(JSON.parse(missingOptionArg.stdout).error.code, "VALIDATION_ERROR");

  const booleanWithArg = invoke(["set", "--format=json", "--dry-run=yes"]);
  assert.equal(booleanWithArg.exitCode, 2);
  assert.equal(JSON.parse(booleanWithArg.stdout).error.code, "VALIDATION_ERROR");

  const missingPositional = invoke(["ios-version"]);
  assert.equal(missingPositional.exitCode, 2);
  assert.match(missingPositional.stderr, /projectName/);

  const unknownCmd = invoke(["nonexistent"]);
  assert.equal(unknownCmd.exitCode, 2);
  assert.match(unknownCmd.stderr, /unknown command/);

  const emptyArgs = invoke([]);
  assert.equal(emptyArgs.exitCode, 1);
  assert.match(emptyArgs.stderr, /Usage: bump-version/);
});
