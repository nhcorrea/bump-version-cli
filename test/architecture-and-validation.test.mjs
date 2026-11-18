import assert from "node:assert/strict";
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
const compiledCliPath = join(repositoryRoot, "dist", "package", "cli.js");
const require = createRequire(import.meta.url);
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

test("exports createProgram without executing the CLI on import", () => {
  const script = [
    `const cli = require(${JSON.stringify(compiledCliPath)});`,
    'if (typeof cli.createProgram !== "function" || typeof cli.runCli !== "function") process.exit(2);',
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

// Native filesystem cases run in tests/migration.rs. The published Node host
// is exercised separately in packaged-io.test.mjs.
