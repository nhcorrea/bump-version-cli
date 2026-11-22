# Automated releases and npm publishing

Added zero-dependency Conventional Commits release automation triggered automatically after `CI` succeeds on `main`.

## Why

Manual tag cutting and separate version edits across `package.json`, `Cargo.toml`, `Cargo.lock`, and `CHANGELOG.md` created friction and risked version drift against the Rust Wasm `expectedVersion == CARGO_PKG_VERSION` check. Keeping release automation dependency-free avoids inflating `yarn.lock` and preserves strict `yarn npm audit --all --recursive` hygiene.

## Implementation

- `scripts/release-commits.mjs`: parses Conventional Commits (`fix`, `perf`, `revert`, `feat`, `!`, `BREAKING CHANGE:`), computes the next semantic version (including initial `1.0.0` bootstrap and resume recovery), generates Markdown release notes, and updates `package.json`, `Cargo.toml`, `Cargo.lock`, and `CHANGELOG.md`.
- `scripts/release-plan.mjs` (`yarn release:plan`): inspects merged `v*` tags and commit history, verifies `HEAD == origin/main` to skip superseded runs, writes GitHub Actions outputs and Markdown release notes.
- `scripts/release-sync.mjs` (`yarn release:sync`): applies the planned version across npm, Cargo, and Keep a Changelog files cleanly.
- `scripts/release-check.mjs`: accepts `--tag` on verified `workflow_run` executions from `refs/heads/main` while preserving artifact integrity and offline tarball smoke checks.
- `.github/workflows/release.yml`: splits into a fast read-only `plan` job and an `npm`-environment `publish` job (only executed when a release is planned) that verifies, builds, commits metadata (`[skip ci]`), publishes `.release/package.tgz` via OIDC Trusted Publishing (`--provenance`), tags `vX.Y.Z`, and creates the GitHub Release with `.release/manifest.json`.
- `scripts/validate-workflows.mjs` and `test/release-automation.test.mjs`: enforce workflow policy invariants and test planning, syncing, changelog updates, and temporary git repository flows.

## Validation

- `node --test`: all tests pass including `test/release-automation.test.mjs`.
- `node scripts/validate-workflows.mjs`: all 4 workflows pass policy checks.
- `node scripts/release-plan.mjs --json`: plans the initial `v1.0.0` release cleanly from the current checkout using the curated `CHANGELOG.md` notes.
- `node scripts/package-smoke.mjs` and `node scripts/release-check.mjs --verify-only --tag v1.0.0`: pass.
