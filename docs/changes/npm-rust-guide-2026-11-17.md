# Consumer and contributor setup

Issue #15, T4. README, CONTRIBUTING and the unreleased changelog describe the
consumer Node floor, both npx aliases, the development LTS, Rust target and
source-build commands. Installation needs only the candidate tarball and Node/npm.

Final documentation build, macOS arm64, Node 26.13.1, 20 iterations:
46.58 ms version p95, 54.56 ms inspect p95, 185,371 unpacked bytes, zero
runtime npm dependencies. The installed Wasm stream is 97,239 bytes. Node
expands it in memory. Package size remains above the 100,000-byte budget.

macOS installation was exercised on Node 22.12.0, 22.23.2, 24.20.0 and
26.13.1. The three-OS CI matrix is configured; Linux/Windows results are
awaiting a CI run. Release eligibility is blocked on the size decision.
