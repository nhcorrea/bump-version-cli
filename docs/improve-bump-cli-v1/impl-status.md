# Issue 15

- T1. Development, audit and release use Node 26.13.1. Clean installation and toolchain checks passed on macOS. The hosted Node 22/24/26 matrix awaits execution.
- T2. All 11 Rust tests and 68 Node tests passed. The packaged Node host now has regression tests for POSIX modes, cleanup, verification and rollback (B2).
- T3.1. The final tarball passed offline installation and execution on macOS arm64 and Linux arm64. Windows smoke is pending.
- T3.2–T3.5. CLI characterization, including replacement of stale success reports on configuration failure (B1), the injectable CommonJS API, package integrity and verify-only release preparation passed on macOS.
- T3.6. Round 2 measured 185,489 unpacked bytes. The round 3 package uses 185,704 bytes under the strict 200,000-byte limit and has zero direct npm runtime dependencies. Its p95 was 51.74 ms for `--version` and 57.69 ms for `inspect`.
- T4. README and CONTRIBUTING document npm/npx use and source builds. See the [distribution note](../changes/wasm-distribution-2026-11-17.md) for round 2 and the [packaged I/O note](../changes/packaged-io-2026-11-18.md) for the round 3 artifact and platform results.
