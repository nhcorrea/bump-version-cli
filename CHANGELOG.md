# Changelog

All notable changes to this project will be documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project intends to follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [1.0.0] - 2026-11-20

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
- CI on Linux, macOS and Windows with Node 22, 24 and 26, offline tarball installation tests, and a performance benchmark.
- Release preflight that rejects versions already present on npm and registry uncertainty.

### Changed

- Runtime baseline is Node `>=22.12.0`.
- Development and release use Node 26.13.1 LTS and Yarn 3.8.7.
- Android and iOS version planning, validation and transactional writes run in Rust. The npm package ships the WebAssembly engine and a Commander 15 entry point for both `bump-version` and `bump-version-cli`.
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
[1.0.0]: https://github.com/nhcorrea/bump-version-cli/compare/5b87f38...v1.0.0
