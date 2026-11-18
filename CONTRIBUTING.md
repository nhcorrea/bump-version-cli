# Contributing

Contributions are welcome. Keep changes small enough to review, preserve project files byte-for-byte outside intended version values, and add a regression fixture for every supported syntax.

## Prerequisites

- Node.js 26.13.1 LTS for development, matching `.node-version`.
- Corepack 0.36.0 and Yarn 3.8.7.
- rustup and the system linker for your platform. Cargo reads `rust-toolchain.toml` and installs Rust 1.100.0, Clippy, rustfmt and `wasm32-unknown-unknown`. On Windows use the MSVC toolchain with Visual Studio C++ Build Tools.

Consumers need Node.js 22.12.0 or newer and npm.

## Build from a clean checkout

```bash
npm install --global corepack@0.36.0
corepack enable
node scripts/verify-toolchain.mjs
corepack yarn@3.8.7 install --immutable
corepack yarn@3.8.7 build
corepack yarn@3.8.7 typecheck
cargo test --locked
corepack yarn@3.8.7 test
corepack yarn@3.8.7 check
corepack yarn@3.8.7 package:install-smoke
corepack yarn@3.8.7 benchmark --enforce
corepack yarn@3.8.7 release:prepare --verify-only --tag v1.0.0
```

Cargo builds the same engine for native tests and for Node's WebAssembly runtime. The benchmark runs the published CommonJS entry and requires p95 below 100 ms for `--version` and 150 ms for `inspect`. The complete unpacked npm package, including the compressed Wasm and license notices, must stay below 200,000 bytes and may have at most one direct npm runtime dependency. The [distribution note](docs/changes/wasm-distribution-2026-11-17.md) records the issue #15 measurements and platform results.

To exercise a candidate tarball in a separate empty directory, pack it from the checkout, then pass its absolute path to npx:

```bash
npm pack --ignore-scripts
# From an empty directory, substitute the absolute path to the file just packed.
npx --offline --yes --package /path/to/nhcorrea-bump-version-cli-1.0.0.tgz -- bump-version-cli --version
```

## Change rules

- Do not introduce a new runtime dependency without measured justification.
- Do not select the first ambiguous version source silently.
- Parsing and transformation belong outside Commander/readline/presentation.
- Dry-run and commit must use the same `ChangePlan`.
- A no-op must preserve bytes and mtime.
- JSON and exit codes are public API; update contract tests for any intentional change.
- Add fixtures containing only the minimal project syntax needed for the case.
- Never add a real application project or secret to fixtures.

Every logical implementation change must include:

1. `docs/changes/{change}-{YYYY-MM-DD}.md` explaining what changed, why, implementation, plan relation, and validation;
2. an update to `docs/improve-bump-cli-v1/impl-status.md`.

## Pull requests

Include the problem, supported/unsupported behavior, tests, and package/benchmark impact. The CI matrix covers Node 22, 24 and 26 on Linux, macOS and Windows. Node 26 jobs also install and execute the candidate tarball. A release-facing change must also pass the installed-tarball smoke.

Do not publish, tag, or push generated release commits from a pull request.

## Releases

Publishing is performed only by the protected `release.yml` tag workflow with npm trusted publishing. Do not add an npm write token or run `yarn npm publish` manually. Follow the [release runbook](docs/improve-bump-cli-v1/release-runbook.md) for prerequisites, gates, tag rules, and recovery.
