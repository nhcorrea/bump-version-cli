import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  describeSpawnFailure,
  spawnCommandSync,
} from "./spawn-command.mjs";
import { compareVersionParts } from "./toolchain-version.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "..");
const packageJson = JSON.parse(
  readFileSync(join(repositoryRoot, "package.json"), "utf8")
);
const packageManagerMatch = /^yarn@(.+)$/.exec(packageJson.packageManager ?? "");
const engineMatch = /^>=(\d+)\.(\d+)\.(\d+)$/.exec(
  packageJson.engines?.node ?? ""
);

assert.ok(packageManagerMatch, "packageManager must pin an exact Yarn version");
assert.ok(engineMatch, "engines.node must use an exact >=major.minor.patch floor");

const expectedYarn = packageManagerMatch[1];
const yarnCommand = process.platform === "win32" ? "yarn.cmd" : "yarn";
const yarnVersionResult = spawnCommandSync(yarnCommand, ["--version"], {
  cwd: repositoryRoot,
  encoding: "utf8",
});

assert.equal(
  yarnVersionResult.status,
  0,
  `could not execute Yarn: ${describeSpawnFailure(yarnVersionResult)}`
);

const actualYarn = yarnVersionResult.stdout.trim();
assert.equal(
  actualYarn,
  expectedYarn,
  `Yarn ${expectedYarn} is required; found ${actualYarn}`
);

const actualNode = process.versions.node
  .split(".")
  .slice(0, 3)
  .map(Number);
const minimumNode = engineMatch.slice(1).map(Number);
const nodeIsSupported = compareVersionParts(actualNode, minimumNode) >= 0;

assert.ok(
  nodeIsSupported,
  `Node ${packageJson.engines.node} is required; found ${process.versions.node}`
);

process.stdout.write(
  `Toolchain OK: Node ${process.versions.node}, Yarn ${actualYarn}\n`
);
