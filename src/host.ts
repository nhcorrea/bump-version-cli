import fs from "node:fs";
import path from "node:path";
import type { EntryKind, Host } from "./types";

const utf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

function stageFile(destination: string, contents: string): string {
  const { randomUUID } = require("node:crypto") as typeof import("node:crypto");
  const dir = path.dirname(destination);
  const tempPath = path.join(dir, `.bump-version-${randomUUID()}.tmp`);
  const target = fs.lstatSync(destination, { throwIfNoEntry: false });
  if (target && !target.isFile()) {
    throw new Error("Expected a regular file.");
  }
  const mode = target ? target.mode & 0o777 : 0o600;
  const fd = fs.openSync(tempPath, "wx", mode);
  try {
    try {
      fs.writeFileSync(fd, contents, "utf8");
      fs.fchmodSync(fd, mode);
    } finally {
      fs.closeSync(fd);
    }
    return tempPath;
  } catch (error) {
    fs.unlinkSync(tempPath);
    throw error;
  }
}

export const nodeHost: Host = {
  absolute: (root, name) => path.resolve(root, name),
  canonical: (name) => fs.realpathSync(name),
  relative(name, root) {
    const relative = path.relative(root, name);
    return path.isAbsolute(relative)
      ? ".."
      : relative.split(path.sep).join("/");
  },
  parent: (name) => path.dirname(name),
  kind(name): EntryKind {
    const stat = fs.lstatSync(name, { throwIfNoEntry: false });
    if (!stat) {
      return "missing";
    }
    if (stat.isFile()) {
      return "file";
    }
    return stat.isDirectory() ? "directory" : "other";
  },
  directories: (name) =>
    fs
      .readdirSync(name, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name),
  read: (name) => utf8.decode(fs.readFileSync(name)),
  stage: stageFile,
  rename: (from, to) => {
    fs.renameSync(from, to);
  },
  remove: (name) => {
    fs.unlinkSync(name);
  },
};
