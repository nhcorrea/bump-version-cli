# Changelog

All notable changes to this project will be documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project intends to follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [1.0.0] - 2026-08-31

### Added

- Non-interactive `inspect`, `set`, `bump`, and `check` commands.
- Stable JSON schema 1 for success and error results.
- Public exit-code contract and atomic `--output-file` reports.
- Optional strict `.bump-version.json` configuration.
- Dry-run, idempotent no-op, optimistic locking, verification, and multi-file rollback.
- Android Groovy/Kotlin adapters with safe `defaultConfig` selection.
- iOS `buildSettings` consistency and indirect-source detection.
- Explicit iOS `PBXNativeTarget`/configuration selection and `--all-targets` policy.
- Actionable human and JSON error hints, with stack traces restricted to `--debug`.
- Node 22/24 CI matrix, package install smoke, and performance benchmark.
- Release preflight that rejects versions already present on npm and registry uncertainty.

### Changed

- Runtime baseline is Node `>=22.12.0`.
- Development is fixed to Yarn 3.8.7.
- Commander is updated to 15; TypeScript to 6.0.3 with Node 22 types/config.
- The published package uses one minimal CLI bundle and exposes `bump-version` plus `bump-version-cli`.
- Human output/help is plain, shorter, and suitable for redirected logs.
- npm metadata now exposes the author name already published in the MIT license.

### Fixed

- iOS updates preserve `;`, whitespace, EOL, and correct build/marketing labels.
- Missing files, incomplete parsing, no matches, conflicts, and write failures now return non-zero.
- Android syntax using `=` is parsed correctly.
- Android `versionCode` enforces the Play range and blocks downgrade by default.

### Removed

- Figlet, its type package, unconditional ANSI colors, and terminal clearing.

### Security

- Explicit root confinement prevents selected project/config/output paths from escaping through lexical paths or symlinks.
- Writes use same-directory temporary files, atomic rename, verification, and rollback.

Implementation-level records are available in [`docs/changes/`](docs/changes/).

[Unreleased]: https://github.com/nhcorrea/bump-version-cli/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/nhcorrea/bump-version-cli/releases/tag/v1.0.0
