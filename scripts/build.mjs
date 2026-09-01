import { rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build as bundle } from "esbuild";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "..");
const outputDirectory = join(repositoryRoot, "dist");
const typescriptCli = join(
  repositoryRoot,
  "node_modules",
  "typescript",
  "bin",
  "tsc"
);

rmSync(outputDirectory, { force: true, recursive: true });

const build = spawnSync(process.execPath, [typescriptCli], {
  cwd: repositoryRoot,
  stdio: "inherit",
});

if (build.error) {
  throw build.error;
}

process.exitCode = build.status ?? 1;

if (build.status === 0) {
  await bundle({
    entryPoints: [join(repositoryRoot, "src", "cli.ts")],
    outfile: join(outputDirectory, "package", "cli.js"),
    bundle: true,
    external: ["commander"],
    platform: "node",
    format: "cjs",
    target: "node22",
    minify: true,
    legalComments: "none",
    sourcemap: false,
  });
}
