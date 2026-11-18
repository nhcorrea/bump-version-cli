# Report and transaction failures in the npm package

Issue #15, round 3, T3.3/B1 and T2.5/B2.

An existing report could keep a previous success document when loading the
configuration failed. Report validation now checks the destination against the
configuration file and project paths independently of schema validation. A
valid report receives the same JSON error as stdout for malformed, unreadable,
missing or out-of-root configurations. If the error report cannot be replaced,
the CLI identifies the destination failure in JSON and sets the corresponding
exit code.

The packaged-host tests run `dist/package/cli.js` and its Wasm module against
real files. They verify POSIX modes, temporary-file cleanup and restoration
after a failed second rename or a failed verification. A separate case denies
restoration and checks both the `ROLLBACK_ERROR` and the bytes left on disk.
In disposable builds, replacing the target mode with 0666 failed the mode
assertion, and disabling temporary-file removal failed the directory comparison.

The macOS arm64 build passed `check` (11 Rust and 68 Node tests), installation
smoke and verify-only release preparation. On Node 26.13.1, the 20-sample
benchmark measured p95 of 51.74 ms for `--version` and 57.69 ms for `inspect`.
The package totals 185,704 unpacked bytes including 97,558 bytes of compressed
Wasm, with zero direct npm runtime dependencies. The 122,781-byte tarball has
SHA-256 `c0fd138272abb1474e30982f6743c05fa14f2c40cd8edd79e45aaa6cf2a5a949`.

That tarball passed offline installation smoke on macOS arm64 with Node 22.12.0,
22.23.2, 24.20.0 and 26.13.1, and in a local Alpine Linux arm64 VM with Node
26.13.1. All six packaged-host tests also passed against the extracted tarball
in the Linux VM. Windows smoke and the hosted CI matrix are pending.
