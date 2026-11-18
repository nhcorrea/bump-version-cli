# Issue 15

- T1. Development, audit and release use Node 26.13.1. Clean installation and toolchain checks passed on macOS. The hosted Node 22/24/26 matrix awaits execution.
- T2. All 11 Rust tests passed, including parser, planning, concurrent-change and rollback cases. All 57 Node tests passed.
- T3.1. The final tarball passed offline installation and execution on macOS arm64 and Linux arm64. Windows smoke is pending.
- T3.2–T3.5. CLI characterization, the injectable CommonJS API, runtime file checks and verify-only release preparation passed on macOS.
- T3.6. The previous candidate exceeded the 100,000-byte budget. The same 185,489-byte package passes the approved strict 200,000-byte budget, with zero direct npm runtime dependencies. Final p95 was 49.26 ms for `--version` and 57.73 ms for `inspect`.
- T4. README and CONTRIBUTING document npm/npx use and source builds. The [distribution note](../changes/wasm-distribution-2026-11-17.md) records the previous and final measurements, tarball hash and installation evidence by platform.
