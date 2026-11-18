# Rust in the npm tarball

Issue #15, T3. Node instantiates a single Rust WebAssembly module and supplies
synchronous filesystem calls. The Brotli stream expands only in memory. The
CommonJS entry retains Commander, the original prompts and the injectable
runtime. Cargo, TypeScript, native platform packages, lifecycle downloads and
runtime npm dependencies are unnecessary for consumers.

The benchmark and characterization suite use the published entry. The smoke
uses an empty offline npm cache and exercises local, temporary global and
standalone installations. Release verification runs it against the exact
tarball after checking integrity.

The build maps local Cargo and checkout paths to virtual roots in Rust panic
locations. Package checks require the CLI, Wasm and notices under `dist/`.

## T3.6 measurements

The benchmark sampled the published entry 20 times per command on macOS arm64
with Node 26.13.1. The initial build measured 184,962 bytes, with p95 of
44.62 ms for `--version` and 54.93 ms for `inspect`. The last two runs below
used the same tarball. On November 18 the project approved a strict
200,000-byte limit for the full unpacked package.

| Clean-checkout run | Unpacked bytes | Size limit | `--version` p95 | `inspect` p95 | Direct npm runtime dependencies | Result |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Previous (`f60ae6f`) | 185,489 | < 100,000 | 47.09 ms | 57.28 ms | 0 | Failed size |
| Final candidate | 185,489 | < 200,000 | 49.26 ms | 57.73 ms | 0 | Passed |

The tarball is 122,539 bytes. Its six files include the 97,357-byte compressed
Wasm. SHA-256 is `31ac8e2cf39a9793c5eda5d41687ca31b5f397da0635ff96bb0f838fd7ec8fa0`.
Build, `check` (11 Rust and 57 Node tests), installed-package smoke,
enforced benchmark and verify-only release preparation passed on macOS.

## T3.1 installation results

Each passing environment ran the repository smoke against that tarball with
an empty offline npm cache and install scripts disabled. It checked both aliases
locally, globally and via standalone npx, and validated the Android fixture's
JSON from `inspect`.

| Platform | Node.js | Result |
| --- | --- | --- |
| macOS arm64 | 22.12.0, 22.23.2, 24.20.0, 26.13.1 | Passed |
| Alpine Linux arm64, kernel 6.12.115 | 26.13.1 | Passed in a local VM as an unprivileged user |
| Windows | 26.13.1 | Pending a Windows runner |

The full hosted Node 22/24/26 matrix still needs a CI run on the issue branch.
