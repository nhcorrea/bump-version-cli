import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { spawnCommandSync, describeSpawnFailure } from "./spawn-command.mjs";

export function smokeTarball(tarball, manifest) {
  const root = mkdtempSync(join(tmpdir(), "bump-installed-"));
  try {
    const local = join(root, "consumer");
    const prefix = join(root, "global");
    const standalone = join(root, "standalone");
    for (const dir of [local, prefix, standalone]) mkdirSync(dir);
    const win = process.platform === "win32";
    const npm = win ? "npm.cmd" : "npm";
    const npx = win ? "npx.cmd" : "npx";
    const paths = Object.fromEntries(
      Object.entries(process.env).filter(([k]) => k.toLowerCase() !== "path"),
    );
    // Give npx only this Node installation, a new cache and the candidate.
    // It cannot use an existing global install, a checkout shim or a registry.
    const env = {
      ...paths,
      PATH: dirname(process.execPath),
      npm_config_script_shell: win ? process.env.ComSpec : "/bin/sh",
      npm_config_cache: join(root, "cache"),
      npm_config_prefix: prefix,
      npm_config_offline: "true",
      npm_config_audit: "false",
      npm_config_fund: "false",
      npm_config_ignore_scripts: "true",
    };
    const run = (cwd, cmd, args) => {
      const result = spawnCommandSync(cmd, args, {
        cwd,
        encoding: "utf8",
        env,
      });
      assert.equal(result.status, 0, describeSpawnFailure(result));
      return result;
    };
    run(local, npm, ["install", "--ignore-scripts", "--no-save", tarball]);
    const aliases = Object.keys(manifest.bin);
    assert.deepEqual(aliases.sort(), ["bump-version", "bump-version-cli"]);
    const version = (result) => {
      assert.equal(result.stdout, manifest.version + "\n");
      assert.equal(result.stderr, "");
    };
    for (const alias of aliases)
      version(run(local, npx, ["--no-install", alias, "--version"]));
    const fixture = fileURLToPath(
      new URL("../test/fixtures/android-groovy/", import.meta.url),
    );
    const inspect = [
      "inspect",
      "--root",
      fixture,
      "--platform",
      "android",
      "--format",
      "json",
    ];
    const validate = (result) => {
      assert.equal(result.stderr, "");
      const doc = JSON.parse(result.stdout);
      assert.equal(doc.schemaVersion, 1);
      assert.equal(doc.ok, true);
      assert.equal(doc.command, "inspect");
      assert.deepEqual(doc.platforms.android.before, {
        versionName: "1.2.3",
        versionCode: 41,
      });
    };
    validate(run(local, npx, ["--no-install", aliases[0], ...inspect]));
    for (const alias of aliases) {
      version(
        run(standalone, npx, [
          "--yes",
          "--package",
          tarball,
          "--",
          alias,
          "--version",
        ]),
      );
    }
    validate(
      run(standalone, npx, [
        "--yes",
        "--package",
        tarball,
        "--",
        aliases[1],
        ...inspect,
      ]),
    );
    // Install globally only after the standalone checks have run.
    run(standalone, npm, [
      "install",
      "--global",
      "--ignore-scripts",
      "--prefix",
      prefix,
      tarball,
    ]);
    for (const alias of aliases) {
      const binary = win
        ? join(prefix, alias + ".cmd")
        : join(prefix, "bin", alias);
      version(run(standalone, binary, ["--version"]));
      validate(run(standalone, binary, inspect));
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
