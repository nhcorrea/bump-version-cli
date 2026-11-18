import { rustNotices } from "./rust-notices.mjs";
import { spawnSync } from "node:child_process";
import { brotliCompressSync } from "node:zlib";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = new URL("../dist/package/", import.meta.url);
const target = "wasm32-unknown-unknown";
const cargo = spawnSync(
  "cargo",
  ["build", "--release", "--locked", "--target", target],
  {
    cwd: root,
    stdio: "inherit",
  },
);
if (cargo.error) throw cargo.error;
if (cargo.status !== 0) process.exit(cargo.status ?? 1);

mkdirSync(output, { recursive: true });
writeFileSync(new URL("RUST-NOTICES.txt", output), rustNotices(root, target));
const wasm = readFileSync(
  new URL(
    "../target/" + target + "/release/bump_version.wasm",
    import.meta.url,
  ),
);
writeFileSync(
  new URL("bump-version.wasm.br", output),
  brotliCompressSync(wasm),
);
await build({
  absWorkingDir: root,
  entryPoints: ["src/cli.cjs"],
  outfile: fileURLToPath(new URL("cli.js", output)),
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  minify: true,
  legalComments: "none",
  footer: {
    js:
      "/*\n" +
      readFileSync(
        new URL("../node_modules/commander/LICENSE", import.meta.url),
        "utf8",
      ) +
      "\n*/",
  },
});
