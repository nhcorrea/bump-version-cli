import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { classifyRegistryVersionResult } from "./registry-version-result.mjs";

if (process.argv.length > 2) {
  process.stderr.write(
    "RELEASE_AVAILABILITY_USAGE: this command reads name/version from package.json and accepts no arguments.\n"
  );
  process.exitCode = 2;
} else {
  const scriptDirectory = dirname(fileURLToPath(import.meta.url));
  const repositoryRoot = resolve(scriptDirectory, "..");
  const packageJson = JSON.parse(
    readFileSync(join(repositoryRoot, "package.json"), "utf8")
  );
  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  const temporaryRoot = mkdtempSync(
    join(tmpdir(), "bump-version-registry-check-")
  );
  const packageSpec = `${packageJson.name}@${packageJson.version}`;

  process.on("exit", () => {
    rmSync(temporaryRoot, { force: true, recursive: true });
  });

  const result = spawnSync(
    npmCommand,
    [
      "view",
      packageSpec,
      "version",
      "--json",
      "--registry=https://registry.npmjs.org",
    ],
    {
      cwd: repositoryRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        npm_config_cache: join(temporaryRoot, "npm-cache"),
        npm_config_update_notifier: "false",
      },
    }
  );

  const classification = classifyRegistryVersionResult(result);

  if (classification.kind === "registry-error") {
    process.stderr.write(
      `RELEASE_REGISTRY_ERROR: npm could not verify ${packageSpec}.\n${classification.diagnostic}\n`
    );
    process.exitCode = 1;
  } else if (classification.kind === "exists") {
    process.stderr.write(
      `RELEASE_VERSION_EXISTS: ${packageSpec} is already published. Update package.json and CHANGELOG.md before creating the tag.\n`
    );
    process.exitCode = 1;
  } else {
    process.stdout.write(
      `Release version available: ${packageSpec} is not present on the npm registry.\n`
    );
  }
}
