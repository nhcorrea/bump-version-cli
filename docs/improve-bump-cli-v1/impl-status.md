# Issue 15

- T1. Development, audit and release use Node 26.13.1. The Node 26 workflows install Corepack in a job-local prefix. All nine hosted Node 22/24/26 jobs passed in [round 4](../changes/windows-ci-toolchain-2026-11-18.md).
- T2. All 11 Rust tests and 68 Node tests passed. The packaged Node host now has regression tests for POSIX modes, cleanup, verification and rollback (B2).
- T3.1. The tarball passed offline installation and execution on macOS arm64 and Linux arm64 locally. The hosted Node 26 install smoke passed on Linux, macOS and Windows in round 4.
- T3.2–T3.5. CLI characterization, including replacement of stale success reports on configuration failure (B1), the injectable CommonJS API, package integrity and verify-only release preparation passed on macOS.
- T3.6. Round 2 measured 185,489 unpacked bytes. The round 3 package uses 185,704 bytes under the strict 200,000-byte limit and has zero direct npm runtime dependencies. Its p95 was 51.74 ms for `--version` and 57.69 ms for `inspect`.
- T4. README and CONTRIBUTING document npm/npx use and source builds. See the [distribution note](../changes/wasm-distribution-2026-11-17.md) for round 2 and the [packaged I/O note](../changes/packaged-io-2026-11-18.md) for the round 3 artifact and platform results.
- CI/CD automated releases. Added zero-dependency Conventional Commits planning, Rust/npm/changelog synchronization, automatic GitHub Releases, and OIDC npm publishing after `CI` succeeds on `main`. See [automated-releases-2026-11-22.md](../changes/automated-releases-2026-11-22.md).
