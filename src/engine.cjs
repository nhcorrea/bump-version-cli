const { version } = require("../package.json");
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { brotliDecompressSync } = require("node:zlib");
const { BumpVersionError } = require("./errors.cjs");

let compiled;
const utf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

function stage(destination, contents) {
  const dir = path.dirname(destination);
  const name = path.join(dir, ".bump-version-" + randomUUID() + ".tmp");
  const target = fs.lstatSync(destination, { throwIfNoEntry: false });
  if (target && !target.isFile()) throw new Error("Expected a regular file.");
  const mode = target ? target.mode & 0o777 : 0o600;
  const fd = fs.openSync(name, "wx", mode);
  try {
    try {
      fs.writeFileSync(fd, contents, "utf8");
      fs.fchmodSync(fd, mode);
    } finally {
      fs.closeSync(fd);
    }
    return name;
  } catch (error) {
    fs.unlinkSync(name);
    throw error;
  }
}

const operations = {
  absolute: (root, name) => path.resolve(root, name),
  canonical: (name) => fs.realpathSync(name),
  relative(name, root) {
    const relative = path.relative(root, name);
    return path.isAbsolute(relative)
      ? ".."
      : relative.split(path.sep).join("/");
  },
  parent: path.dirname,
  kind(name) {
    const stat = fs.lstatSync(name, { throwIfNoEntry: false });
    if (!stat) return "missing";
    if (stat.isFile()) return "file";
    return stat.isDirectory() ? "directory" : "other";
  },
  directories: (name) =>
    JSON.stringify(
      fs
        .readdirSync(name, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name),
    ),
  read: (name) => utf8.decode(fs.readFileSync(name)),
  stage,
  rename: (from, to) => {
    fs.renameSync(from, to);
    return "";
  },
  remove: (name) => {
    fs.unlinkSync(name);
    return "";
  },
};

function request(data) {
  compiled ??= new WebAssembly.Module(
    brotliDecompressSync(
      fs.readFileSync(path.join(__dirname, "bump-version.wasm.br")),
    ),
  );
  let reply;
  const { exports: wasm } = new WebAssembly.Instance(compiled, {
    os: {
      invoke(pointer, length) {
        const [operation, args] = JSON.parse(
          utf8.decode(new Uint8Array(wasm.memory.buffer, pointer, length)),
        );
        try {
          reply = Buffer.from(
            JSON.stringify([true, operations[operation](...args)]),
          );
        } catch (error) {
          reply = Buffer.from(JSON.stringify([false, error.message]));
        }
        return reply.length;
      },
      receive(pointer) {
        new Uint8Array(wasm.memory.buffer, pointer, reply.length).set(reply);
      },
    },
  });
  const bytes = Buffer.from(JSON.stringify({ ...data, expectedVersion: version }));
  const pointer = wasm.input(bytes.length);
  new Uint8Array(wasm.memory.buffer, pointer, bytes.length).set(bytes);
  const size = wasm.run();
  const result = JSON.parse(
    utf8.decode(new Uint8Array(wasm.memory.buffer, wasm.output(), size)),
  );
  if (!result.ok) {
    const { code, message, path, details } = result.error;
    throw new BumpVersionError(code, message, path, undefined, details);
  }
  return result.value;
}

module.exports = { request };
