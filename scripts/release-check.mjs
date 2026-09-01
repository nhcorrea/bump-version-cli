import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  constants,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnCommandSync } from "./spawn-command.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "..");
const packageJson = JSON.parse(
  readFileSync(join(repositoryRoot, "package.json"), "utf8")
);
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const temporaryRoot = mkdtempSync(join(tmpdir(), "bump-version-release-"));
const npmCache = join(temporaryRoot, "npm-cache");
const verifyOnly = process.argv.includes("--verify-only");
const tagOptionIndex = process.argv.indexOf("--tag");
const tagOption =
  tagOptionIndex >= 0 ? process.argv[tagOptionIndex + 1] : undefined;
const knownArguments = new Set(["--verify-only", "--tag", tagOption]);

process.on("exit", () => {
  rmSync(temporaryRoot, { force: true, recursive: true });
});

for (const argument of process.argv.slice(2)) {
  assert.ok(knownArguments.has(argument), `unknown argument: ${argument}`);
}

if (tagOptionIndex >= 0) {
  assert.ok(tagOption, "--tag requires a value");
  assert.ok(verifyOnly, "--tag is only available with --verify-only");
}

if (!verifyOnly) {
  assert.equal(
    process.env.GITHUB_ACTIONS,
    "true",
    "release artifacts may only be prepared by GitHub Actions"
  );
  assert.equal(
    process.env.GITHUB_REF_TYPE,
    "tag",
    "release workflow must run from a tag"
  );
}

const actualTag = tagOption ?? process.env.GITHUB_REF_NAME;
const expectedTag = `v${packageJson.version}`;
assert.equal(
  actualTag,
  expectedTag,
  `release tag ${actualTag ?? "<missing>"} does not match package ${expectedTag}`
);

if (!verifyOnly) {
  const npmVersionResult = spawnCommandSync(npmCommand, ["--version"], {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
  assert.equal(
    npmVersionResult.status,
    0,
    `could not determine npm version: ${npmVersionResult.stderr}`
  );

  const npmVersion = npmVersionResult.stdout.trim();
  const versionMatch = /^(\d+)\.(\d+)\.(\d+)/.exec(npmVersion);
  assert.ok(versionMatch, `invalid npm version: ${npmVersion}`);
  const [, major, minor] = versionMatch.map(Number);
  assert.ok(
    major > 11 || (major === 11 && minor >= 5),
    `trusted publishing requires npm >=11.5.1; found ${npmVersion}`
  );
}

const pack = spawnCommandSync(
  npmCommand,
  [
    "pack",
    "--json",
    "--ignore-scripts",
    "--pack-destination",
    temporaryRoot,
  ],
  {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      npm_config_cache: npmCache,
    },
  }
);

assert.equal(pack.status, 0, `npm pack failed:\n${pack.stderr || pack.stdout}`);

const [manifest] = JSON.parse(pack.stdout);
assert.ok(manifest, "npm pack did not return a package manifest");
assert.equal(manifest.name, packageJson.name);
assert.equal(manifest.version, packageJson.version);

const files = new Set(manifest.files.map(({ path }) => path));
const mainPath = packageJson.main.replace(/^\.\//, "");
const binPaths = Object.values(packageJson.bin ?? {}).map((path) =>
  path.replace(/^\.\//, "")
);

assert.equal(packageJson.repository?.url, "git+https://github.com/nhcorrea/bump-version-cli.git");
assert.equal(packageJson.publishConfig?.access, "public");
assert.ok(files.has("LICENSE"), "release package is missing LICENSE");
assert.ok(files.has("README.md"), "release package is missing README.md");
assert.ok(files.has("package.json"), "release package is missing package.json");
assert.ok(files.has(mainPath), `release package is missing main: ${mainPath}`);

for (const binPath of binPaths) {
  assert.equal(binPath, mainPath, `release bin differs from main: ${binPath}`);
  assert.ok(files.has(binPath), `release package is missing bin: ${binPath}`);
}

const publishedJavaScript = [...files].filter(
  (file) => file.startsWith("dist/") && file.endsWith(".js")
);
assert.deepEqual(
  publishedJavaScript,
  [mainPath],
  "release package must contain only the bundled CLI JavaScript"
);

const packedTarball = join(temporaryRoot, manifest.filename);
const tarballBytes = readFileSync(packedTarball);
const sha256 = createHash("sha256").update(tarballBytes).digest("hex");
const releaseManifest = {
  schemaVersion: 1,
  name: manifest.name,
  version: manifest.version,
  tag: actualTag,
  filename: "package.tgz",
  sha256,
  integrity: manifest.integrity,
  shasum: manifest.shasum,
  size: manifest.size,
  unpackedSize: manifest.unpackedSize,
  entryCount: manifest.entryCount,
  files: manifest.files.map(({ path, size }) => ({ path, size })),
};

if (!verifyOnly) {
  const releaseDirectory = join(repositoryRoot, ".release");

  if (existsSync(releaseDirectory)) {
    assert.deepEqual(
      readdirSync(releaseDirectory),
      [],
      ".release must be empty before preparing an artifact"
    );
  } else {
    mkdirSync(releaseDirectory);
  }

  copyFileSync(
    packedTarball,
    join(releaseDirectory, "package.tgz"),
    constants.COPYFILE_EXCL
  );
  writeFileSync(
    join(releaseDirectory, "manifest.json"),
    `${JSON.stringify(releaseManifest, null, 2)}\n`,
    { flag: "wx" }
  );
}

process.stdout.write(
  `${verifyOnly ? "Release verification" : "Release artifact"} OK: ${manifest.name}@${manifest.version}, ${manifest.entryCount} files, sha256 ${sha256}\n`
);
