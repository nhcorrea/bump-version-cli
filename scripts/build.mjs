import { chmodSync, mkdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = fileURLToPath(new URL("../", import.meta.url));
const packageOutput = fileURLToPath(new URL("../dist/package/", import.meta.url));
const cliOutfile = fileURLToPath(
  new URL("../dist/package/cli.js", import.meta.url),
);
const coreOutfile = fileURLToPath(new URL("../dist/core.cjs", import.meta.url));

rmSync(packageOutput, { force: true, recursive: true });
mkdirSync(packageOutput, { recursive: true });

await Promise.all([
  build({
    absWorkingDir: root,
    entryPoints: ["src/cli.ts"],
    outfile: cliOutfile,
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node22",
    minify: true,
    legalComments: "none",
  }),
  build({
    absWorkingDir: root,
    entryPoints: ["src/core-exports.ts"],
    outfile: coreOutfile,
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node22",
    legalComments: "none",
  }),
]);

if (process.platform !== "win32") {
  chmodSync(cliOutfile, 0o755);
}
