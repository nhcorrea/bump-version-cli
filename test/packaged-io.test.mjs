import assert from "node:assert/strict";
import fs from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import cli from "../dist/package/cli.js";

const fixtures = fileURLToPath(new URL("./fixtures/", import.meta.url));

function fixture(t, ...names) {
  const root = fs.realpathSync(
    fs.mkdtempSync(join(tmpdir(), "bump-packaged-io-")),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const name of names)
    fs.cpSync(join(fixtures, name), root, { recursive: true });
  return root;
}

// The package uses the bundled TypeScript engine and Node filesystem host. Capture only
// the CLI's terminal interface; each test scopes its filesystem fault with t.mock.
function run(root, args) {
  let status = 0;
  const stdout = [];
  const stderr = [];
  cli
    .createProgram({
      cwd: () => root,
      log: (line) => stdout.push(line),
      error: (line) => stderr.push(line),
      setExitCode: (code) => {
        status = code;
      },
    })
    .parse([...args, "--format", "json"], { from: "user" });
  assert.deepEqual(stderr, []);
  assert.equal(stdout.length, 1);
  return { status, document: JSON.parse(stdout[0]), stdout: stdout[0] + "\n" };
}

test("an unreadable config replaces the previous report with its parse error", (t) => {
  const root = fixture(t, "android-groovy");
  const args = [
    "inspect",
    "--platform",
    "android",
    "--output-file",
    "out.json",
  ];
  assert.equal(run(root, args).status, 0);
  const config = join(root, ".bump-version.json");
  fs.writeFileSync(config, "{}");
  const read = fs.readFileSync;
  t.mock.method(fs, "readFileSync", (file, ...options) => {
    if (file === config) throw new Error("config read denied");
    return read(file, ...options);
  });
  const result = run(root, args);
  assert.equal(result.status, 4);
  assert.equal(result.document.error.code, "PARSE_ERROR");
  assert.equal(fs.readFileSync(join(root, "out.json"), "utf8"), result.stdout);
});

test("a failed error-report replacement identifies the destination without --debug", (t) => {
  const root = fixture(t, "android-groovy");
  const args = [
    "inspect",
    "--platform",
    "android",
    "--output-file",
    "out.json",
  ];
  const success = run(root, args);
  assert.equal(success.status, 0);
  const report = join(root, "out.json");
  const rename = fs.renameSync;
  t.mock.method(fs, "renameSync", (from, to) => {
    if (to === report) throw new Error("report rename denied");
    return rename(from, to);
  });
  const result = run(root, [...args, "--config", "missing.json"]);
  assert.equal(result.status, 6);
  assert.equal(result.document.error.code, "WRITE_ERROR");
  assert.equal(result.document.error.details.path, report);
  assert.equal(fs.readFileSync(report, "utf8"), success.stdout);
  assert.deepEqual(fs.readdirSync(root).sort(), ["android", "out.json"]);
});

function mobileProject(t) {
  const root = fixture(t, "android-groovy", "ios-basic");
  const android = join(root, "android", "app", "build.gradle");
  const ios = join(root, "ios", "Audit.xcodeproj", "project.pbxproj");
  if (process.platform !== "win32") {
    fs.chmodSync(android, 0o640);
    fs.chmodSync(ios, 0o604);
  }
  return { root, android, ios };
}

const setBoth = [
  "set",
  "--platform",
  "all",
  "--app-version",
  "1.2.4",
  "--version-code",
  "42",
  "--build-number",
  "42",
];

function checkModes(android, ios) {
  if (process.platform !== "win32") {
    assert.equal(fs.statSync(android).mode & 0o777, 0o640);
    assert.equal(fs.statSync(ios).mode & 0o777, 0o604);
  }
}

test("a packaged two-target set preserves project file permissions on POSIX", (t) => {
  const { root, android, ios } = mobileProject(t);
  const result = run(root, setBoth);
  assert.equal(result.status, 0);
  assert.equal(result.document.changed, true);
  assert.match(fs.readFileSync(android, "utf8"), /versionCode 42/);
  assert.match(fs.readFileSync(ios, "utf8"), /CURRENT_PROJECT_VERSION = 42;/);
  checkModes(android, ios);
});

for (const [fault, code] of [
  ["second rename", "WRITE_ERROR"],
  ["second rename and first restore", "ROLLBACK_ERROR"],
  ["post-commit verification", "VERIFY_ERROR"],
]) {
  test(`packaged transaction after failed ${fault}`, (t) => {
    const { root, android, ios } = mobileProject(t);
    const read = fs.readFileSync;
    const rename = fs.renameSync;
    const originalAndroid = read(android, "utf8");
    const originalIos = read(ios, "utf8");
    const androidEntries = fs.readdirSync(dirname(android)).sort();
    const iosEntries = fs.readdirSync(dirname(ios)).sort();
    const attempts = [];
    let androidAtSecondTarget;
    let corruptNextRead = false;
    t.mock.method(fs, "renameSync", (from, to) => {
      attempts.push(to);
      if (to === ios && attempts.length === 2) {
        androidAtSecondTarget = read(android, "utf8");
        if (code !== "VERIFY_ERROR") throw new Error("second rename denied");
        corruptNextRead = true;
      }
      if (
        to === android &&
        attempts.length === 3 &&
        code === "ROLLBACK_ERROR"
      ) {
        throw new Error("restore denied");
      }
      return rename(from, to);
    });
    t.mock.method(fs, "readFileSync", (file, ...options) => {
      if (file === ios && corruptNextRead) {
        corruptNextRead = false;
        return Buffer.from("unexpected contents on verification");
      }
      return read(file, ...options);
    });

    const result = run(root, setBoth);
    assert.equal(result.status, 6);
    assert.equal(result.document.error.code, code);
    const updatedAndroid = originalAndroid
      .replace("versionCode 41", "versionCode 42")
      .replace('versionName "1.2.3"', 'versionName "1.2.4"');
    assert.equal(androidAtSecondTarget, updatedAndroid);
    assert.deepEqual(
      attempts,
      code === "VERIFY_ERROR"
        ? [android, ios, ios, android]
        : [android, ios, android],
    );
    assert.equal(
      read(android, "utf8"),
      code === "ROLLBACK_ERROR" ? updatedAndroid : originalAndroid,
    );
    assert.equal(read(ios, "utf8"), originalIos);
    checkModes(android, ios);
    assert.deepEqual(fs.readdirSync(dirname(android)).sort(), androidEntries);
    assert.deepEqual(fs.readdirSync(dirname(ios)).sort(), iosEntries);
  });
}
