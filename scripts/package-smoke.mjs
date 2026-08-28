import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "..");
const packageJson = JSON.parse(
  readFileSync(join(repositoryRoot, "package.json"), "utf8")
);
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const installMode = process.argv.includes("--install");
const smokeRoot = mkdtempSync(join(tmpdir(), "bump-version-package-smoke-"));
const npmCache = join(smokeRoot, "npm-cache");

process.on("exit", () => {
  rmSync(smokeRoot, { force: true, recursive: true });
});

const packArguments = ["pack", "--json", "--ignore-scripts"];

if (installMode) {
  packArguments.push("--pack-destination", smokeRoot);
} else {
  packArguments.push("--dry-run");
}

const pack = spawnSync(
  npmCommand,
  packArguments,
  {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      npm_config_cache: npmCache,
    },
  }
);

assert.equal(
  pack.status,
  0,
  `npm pack failed:\n${pack.stderr || pack.stdout}`
);

const [manifest] = JSON.parse(pack.stdout);
assert.ok(manifest, "npm pack did not return a package manifest");
assert.equal(manifest.name, packageJson.name);
assert.equal(manifest.version, packageJson.version);

const files = new Set(manifest.files.map(({ path }) => path));
const binPaths =
  typeof packageJson.bin === "string"
    ? [packageJson.bin]
    : Object.values(packageJson.bin ?? {});

for (const binPath of binPaths) {
  const normalizedPath = binPath.replace(/^\.\//, "");
  assert.ok(files.has(normalizedPath), `bin is missing from package: ${binPath}`);

  const binContent = readFileSync(join(repositoryRoot, normalizedPath), "utf8");
  assert.ok(binContent.startsWith("#!/usr/bin/env node\n"), `${binPath} has no Node shebang`);
}

for (const file of files) {
  assert.doesNotMatch(file, /^(?:docs|src|test|node_modules)\//);
  assert.notEqual(file, "index.ts");
}

const primaryBin = binPaths[0].replace(/^\.\//, "");
let smoke;

if (installMode) {
  const consumerRoot = join(smokeRoot, "consumer");
  const tarballPath = join(smokeRoot, manifest.filename);
  const install = spawnSync(
    npmCommand,
    [
      "install",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--no-save",
      "--prefix",
      consumerRoot,
      tarballPath,
    ],
    {
      cwd: smokeRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        npm_config_cache: npmCache,
      },
    }
  );

  assert.equal(
    install.status,
    0,
    `tarball install failed:\n${install.stderr || install.stdout}`
  );

  const binName =
    typeof packageJson.bin === "string"
      ? packageJson.name.replace(/^@[^/]+\//, "")
      : Object.keys(packageJson.bin)[0];
  const installedBin = join(
    consumerRoot,
    "node_modules",
    ".bin",
    process.platform === "win32" ? `${binName}.cmd` : binName
  );

  smoke = spawnSync(installedBin, ["--version"], {
    cwd: consumerRoot,
    encoding: "utf8",
  });
} else {
  smoke = spawnSync(
    process.execPath,
    [join(repositoryRoot, primaryBin), "--version"],
    {
      cwd: repositoryRoot,
      encoding: "utf8",
    }
  );
}

assert.equal(
  smoke.status,
  0,
  `packaged bin smoke failed:\n${smoke.stderr || smoke.stdout}`
);
assert.match(smoke.stdout, new RegExp(`v${packageJson.version.replaceAll(".", "\\.")}\\b`));

process.stdout.write(
  `Package ${installMode ? "install " : ""}smoke OK: ${manifest.name}@${manifest.version}, ${manifest.entryCount} files, ${manifest.size} bytes\n`
);
