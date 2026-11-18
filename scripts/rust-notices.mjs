import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

// Keep notices alongside the redistributed Wasm, including when Cargo.lock
// changes. Several crates ship identical texts, which need only one copy.
export function rustNotices(root, target) {
  const read = (file) => readFileSync(file, "utf8").replaceAll("\r\n", "\n").trim();
  const metadata = JSON.parse(execFileSync("cargo", [
    "metadata", "--format-version", "1", "--locked", "--filter-platform", target,
  ], {cwd: root, encoding: "utf8"}));
  const notices = new Map();
  function add(name, file) {
    const text = read(file);
    const names = notices.get(text) ?? [];
    notices.set(text, [...names, name]);
  }
  const sysroot = execFileSync("rustc", ["--print", "sysroot"], {cwd: root, encoding: "utf8"}).trim();
  add("Rust standard library", join(sysroot, "share/doc/rust/licenses/MIT.txt"));
  for (const pkg of metadata.packages) {
    if (!pkg.source) continue;
    const dir = dirname(pkg.manifest_path);
    const mit = join(dir, "LICENSE-MIT");
    add(pkg.name, existsSync(mit) ? mit : join(dir, "LICENSE"));
    const unicode = join(dir, "LICENSE-UNICODE");
    if (existsSync(unicode)) add(pkg.name, unicode);
  }
  return [...notices].map(([text, names]) => names.join(", ") + "\n\n" + text).join("\n\n") + "\n";
}
