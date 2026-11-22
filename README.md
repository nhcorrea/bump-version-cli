# Bump Version CLI

[![npm version](https://img.shields.io/npm/v/@nhcorrea/bump-version-cli)](https://www.npmjs.com/package/@nhcorrea/bump-version-cli)
[![CI](https://github.com/nhcorrea/bump-version-cli/actions/workflows/ci.yml/badge.svg)](https://github.com/nhcorrea/bump-version-cli/actions/workflows/ci.yml)
[![Node >=22.12.0](https://img.shields.io/badge/node-%3E%3D22.12.0-339933)](https://nodejs.org/)
[![Zero runtime dependencies](https://img.shields.io/badge/dependencies-0-brightgreen)](https://www.npmjs.com/package/@nhcorrea/bump-version-cli)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**Fast, CI/CD-ready CLI powered by a Rust WebAssembly engine to inspect, validate, set, and bump Android and iOS app versions.**

Works seamlessly with **React Native CLI**, **Expo Bare**, native **Android** (`build.gradle` / `build.gradle.kts`), and native **iOS** (`project.pbxproj` / Xcode) projects — with **zero runtime dependencies**, non-interactive automation by default, stable JSON output, and atomic multi-file writes with verification and rollback.

## Contents

- [Why Bump Version CLI?](#why-bump-version-cli)
- [Requirements](#requirements)
- [Install](#install)
- [Quick start](#quick-start)
- [Commands & options](#commands--options)
- [CI/CD integration](#cicd-integration)
- [JSON schema 1 & exit codes](#json-schema-1--exit-codes)
- [Configuration file](#configuration-file)
- [Project support](#project-support)
- [Write safety & architecture](#write-safety--architecture)
- [What's new in v1.0](#whats-new-in-v10)
- [Legacy commands](#legacy-commands)
- [Development & releases](#development--releases)

## Why Bump Version CLI?

- **Rust + WebAssembly speed:** Android and iOS parsing, version planning, validation, and transactional writes run in Rust compiled to Wasm (`< 50 ms` p95 startup and inspection).
- **Zero runtime dependencies & offline-safe install:** Ships as a compact `< 200 KB` npm package with no native compilation, no platform-specific binaries, and no `postinstall` scripts (`--ignore-scripts` compatible).
- **Built for CI/CD pipelines:** Canonical commands (`inspect`, `set`, `bump`, `check`) never prompt, work with closed `stdin`, emit stable JSON schema 1, write atomic `--output-file` reports, and return documented exit codes.
- **Atomic writes, verification & rollback:** `--dry-run` and commit share the exact same `ChangePlan`. Writes stage next to target files, guard against concurrent edits, verify parsed output on disk, and roll back in reverse order on failure.
- **Byte-preserving native edits:** Updates Android `versionName` / `versionCode` (Groovy and Kotlin DSL) and iOS `MARKETING_VERSION` / `CURRENT_PROJECT_VERSION` (with explicit `PBXNativeTarget` and build configuration selection) while preserving comments, quotes, semicolons, whitespace, CRLF/LF, and file modes.

## Requirements

- **Node.js `>=22.12.0`** and npm. The tarball includes the Rust engine as Brotli-compressed WebAssembly, expanded in memory at runtime.
- Android or iOS native project files matching the [project support matrix](#project-support).

## Install

Install as a local devDependency for reproducible CI/CD pipelines (recommended):

```bash
npm install --save-dev @nhcorrea/bump-version-cli@1
npx --no-install bump-version --version
npx --no-install bump-version-cli --version
```

Global installation:

```bash
npm install --global @nhcorrea/bump-version-cli@1
bump-version --version
```

One-off invocation with `npx`:

```bash
npx --package @nhcorrea/bump-version-cli@1 -- bump-version --version
```

Both `bump-version` and `bump-version-cli` point to the same package and work with npm lifecycle scripts disabled (`--ignore-scripts`). To run from an unpublished checkout, see [Development & releases](#development--releases).

## Quick start

Inspect current Android and iOS versions:

```bash
npx --no-install bump-version inspect --platform all
```

Preview an exact multi-platform version update without writing files:

```bash
npx --no-install bump-version set \
  --platform all \
  --app-version 1.2.4 \
  --version-code 42 \
  --build-number 42 \
  --dry-run
```

Apply the same change non-interactively and emit JSON:

```bash
npx --no-install bump-version set \
  --platform all \
  --app-version 1.2.4 \
  --version-code 42 \
  --build-number 42 \
  --non-interactive \
  --format json
```

Bump the patch version and increment both platform build numbers:

```bash
npx --no-install bump-version bump \
  --platform all \
  --release patch \
  --increment-build \
  --non-interactive
```

Verify that both platforms match a target release version (release gate):

```bash
npx --no-install bump-version check \
  --platform all \
  --app-version 1.2.4 \
  --format json
```

## Commands & options

| Command | Purpose | Writes native project files |
| --- | --- | --- |
| `inspect` | Read current versions and source match counts | No |
| `set` | Set exact marketing versions and build numbers | Yes, unless `--dry-run` |
| `bump` | Increment `major`, `minor`, or `patch` | Yes, unless `--dry-run` |
| `check` | Compare project values against expected versions | No |

Run `bump-version <command> --help` for full command options and examples.

### Common options

| Option | Meaning |
| --- | --- |
| `--root <path>` | Project root; defaults to the current directory |
| `--platform android\|ios\|all` | Platform selection; defaults to `all` |
| `--android-file <path>` | Explicit `build.gradle` or `build.gradle.kts` path |
| `--android-module <name>` | Android module under `android/`; defaults to `app` |
| `--ios-project <name-or-path>` | `.xcodeproj` name/path or `project.pbxproj` path |
| `--ios-target <name>` | Exact `PBXNativeTarget` name |
| `--ios-configuration <name>` | Exact build configuration inside selected target(s) |
| `--all-targets` | Explicitly select every native iOS target |
| `--config <path>` | Explicit config file; default discovery is `.bump-version.json` |
| `--format human\|json` | Output format; defaults to `human` |
| `--output-file <path>` | Atomically save the JSON result inside `--root` |
| `--non-interactive` | Explicitly forbid prompts |
| `--dry-run` | Build and validate the same plan without writing (`set`/`bump`) |
| `--debug` | Print internal stack/cause details to `stderr` |
| `--quiet` | Suppress non-essential diagnostics |
| `--no-color` | Disable color (canonical output is plain text already) |

### Version options

| Option | Field |
| --- | --- |
| `--app-version <x.y.z>` | Android `versionName` and iOS `MARKETING_VERSION` |
| `--version-name <x.y.z>` | Android `versionName` only |
| `--version-code <integer>` | Android `versionCode`, range `1..2,100,000,000` |
| `--marketing-version <x.y.z>` | iOS `MARKETING_VERSION` only |
| `--build-number <integer>` | iOS `CURRENT_PROJECT_VERSION` |
| `--allow-downgrade` | Explicitly allow a lower Android `versionCode` |
| `--release major\|minor\|patch` | Increment policy for `bump` |
| `--increment-build` | Increment platform build numbers during `bump` |

CLI flags override config file values. Omitted build numbers are never guessed from timestamps or another platform.

## CI/CD integration

Canonical commands work with closed `stdin` and never prompt. Setting `CI=true` also disables legacy interactive commands. Structured JSON is written to `stdout`; diagnostics and `--debug` details go to `stderr`.

### GitHub Actions example

```yaml
- name: Bump native versions
  shell: bash
  run: |
    mkdir -p .artifacts
    npx --no-install bump-version bump \
      --root . \
      --platform all \
      --release patch \
      --increment-build \
      --non-interactive \
      --format json \
      --output-file .artifacts/bump-result.json
    git diff -- android ios

- name: Upload bump result
  uses: actions/upload-artifact@v4
  with:
    name: bump-result
    path: .artifacts/bump-result.json
```

Validate versions in a release gate without touching files:

```bash
npx --no-install bump-version check \
  --platform all \
  --app-version "$RELEASE_VERSION" \
  --format json
```

- The CLI only updates local project files; it never runs `git commit`, `git tag`, `git push`, or publish steps. Keep those in dedicated protected pipeline steps.
- Parse JSON with `jq` or your pipeline runtime instead of `eval`.
- Projects with multiple iOS targets must pass `--ios-target <name>` or `--all-targets` explicitly in CI.

## JSON schema 1 & exit codes

### Success document

```json
{
  "schemaVersion": 1,
  "ok": true,
  "command": "set",
  "changed": true,
  "dryRun": false,
  "root": "/workspace/app",
  "platforms": {
    "android": {
      "path": "android/app/build.gradle",
      "before": { "versionName": "1.2.3", "versionCode": 41 },
      "after": { "versionName": "1.2.4", "versionCode": 42 },
      "matches": 2,
      "matchCounts": { "build": 1, "marketing": 1, "total": 2 }
    }
  },
  "warnings": []
}
```

### Error document

```json
{
  "schemaVersion": 1,
  "ok": false,
  "command": "check",
  "error": {
    "code": "CHECK_MISMATCH",
    "message": "Expected Android versionName 1.2.4, found 1.2.3.",
    "hint": "Run inspect --format json to compare the current and expected values.",
    "details": {
      "path": "/workspace/app/android/app/build.gradle",
      "expected": "1.2.4",
      "actual": "1.2.3"
    }
  }
}
```

Expected errors always include a stable `code`, relevant path/details, and an actionable `hint`. Human output prints the same hint without stack traces unless `--debug` is set. New fields may be added compatibly to schema 1; breaking changes increment `schemaVersion`.

### Exit codes

| Code | Meaning |
| ---: | --- |
| `0` | Success, dry-run, or idempotent no-op |
| `2` | Invalid or missing argument, option, or value |
| `3` | Root, file, module, or Xcode project not found |
| `4` | Unsupported syntax, missing field, or ambiguous version source |
| `5` | Version conflict, blocked Android `versionCode` downgrade, or `check` mismatch |
| `6` | Write, verification, or rollback failure |
| `70` | Unexpected internal error |

## Configuration file

Add an optional `.bump-version.json` in your repository root to version project defaults:

```json
{
  "schemaVersion": 1,
  "platform": "all",
  "android": {
    "module": "app",
    "versionName": "1.2.4",
    "versionCode": 42
  },
  "ios": {
    "project": "App",
    "target": "App",
    "marketingVersion": "1.2.4",
    "buildNumber": 42
  }
}
```

The config parser is strict: unknown keys, invalid types, unsupported schema versions, and config paths escaping `--root` fail before any project file is modified.

Precedence order: **1. CLI flags** → **2. `.bump-version.json`** → **3. safe path autodetection**.

## Project support

Support is capability-based rather than framework-name based:

| Project source | Supported behavior |
| --- | --- |
| Android Groovy (`build.gradle`) | Single `defaultConfig`; direct literal `versionCode` and `versionName`; space or `=` syntax; single/double quotes |
| Android Kotlin DSL (`build.gradle.kts`) | Single `defaultConfig`; direct literal assignments with `=`; double-quoted `versionName` |
| iOS Xcode (`project.pbxproj`) | `PBXNativeTarget`/configuration graph; paired direct literals in `buildSettings`; exact target/configuration or `--all-targets` |
| React Native CLI | Supported when native Android/iOS files match the rules above |
| Expo Bare | Supported when local native files are the effective version source |

### iOS target and configuration selection

Projects with more than one `PBXNativeTarget` are treated as ambiguous by default so extensions (widgets, notification services, Watch apps) are never overwritten silently.

Select a specific target and optional build configuration:

```bash
npx --no-install bump-version inspect \
  --platform ios \
  --ios-project App \
  --ios-target App \
  --ios-configuration Release \
  --format json
```

Or opt in to update every native target explicitly:

```bash
npx --no-install bump-version set \
  --platform ios \
  --all-targets \
  --marketing-version 1.2.4 \
  --build-number 42 \
  --dry-run
```

All selected target/configuration blocks must contain a direct pair and share identical current values. Divergent targets should be updated individually with `--ios-target`.

### Deliberately rejected

- Android flavor/build-type version overrides or duplicate assignments;
- Gradle variables, providers, version catalogs, or properties as the version source;
- Multiple iOS targets without `--ios-target` or `--all-targets`, duplicate names, or divergent blocks in scope;
- iOS variables, `$(inherited)` values, or `.xcconfig`-sourced versions;
- Expo managed/dynamic app config (`app.json`/`app.config.*`) or EAS remote app versions.

Unsupported or ambiguous sources return exit `4`; missing files or projects return exit `3`.

## Write safety & architecture

1. **Confinement:** Selected project, config, and `--output-file` paths are confined inside `--root` (blocking lexical traversal and symlink escapes).
2. **Unified planning:** Every platform is parsed and validated into a `ChangePlan` inside the Rust WebAssembly core before touching disk.
3. **Atomic commit & rollback:** Each modified file is staged in a same-directory temp file with preserved permissions, checked against concurrent modifications immediately before atomic rename, read back, and re-parsed for verification. Any failure triggers reverse-order rollback across previously updated files.
4. **Idempotent no-ops:** When target values already match, project files are untouched (preserving exact bytes and `mtime`). Passing `--output-file` still writes the JSON report (including during `--dry-run`).

## What's new in v1.0

- **Rust WebAssembly core** replacing legacy JavaScript string transforms for faster execution and stronger safety guarantees.
- **CI/CD-first commands** (`inspect`, `set`, `bump`, `check`), JSON schema 1, public exit-code contract, and `.bump-version.json` support.
- **Android Kotlin DSL (`build.gradle.kts`)** and `=` assignment support, plus Play Store `versionCode` bounds and downgrade protection.
- **Multi-target iOS selection** (`--ios-target`, `--ios-configuration`, `--all-targets`) with `;`, whitespace, and EOL preservation.
- **Zero runtime dependencies** (removed `figlet`, unconditional ANSI colors, and terminal clearing) and automated CI/CD releases with npm provenance.

See the full release history in [CHANGELOG.md](CHANGELOG.md).

## Legacy commands

Interactive 0.x commands remain available as deprecated transition aliases:

| Legacy command | Canonical replacement |
| --- | --- |
| `android-version` | `inspect --platform android` |
| `ios-version <project>` | `inspect --platform ios --ios-project <project>` |
| `android` | `set --platform android` with explicit flags |
| `ios <project>` | `set --platform ios --ios-project <project>` with explicit flags |

Legacy mutation commands fail fast under `CI=true` or `--non-interactive`.

## Development & releases

Building from source requires **Node 26.13.1 LTS**, **Corepack 0.36.0** (Yarn 3.8.7), **rustup** (pins Rust `1.100.0`, `rustfmt`, `clippy`, and `wasm32-unknown-unknown`), and a system linker:

```bash
npm install --global corepack@0.36.0
corepack enable
yarn install --immutable
yarn build
node dist/package/cli.js inspect --root test/fixtures/android-groovy --platform android
node dist/package/cli.js bump --root test/fixtures/android-groovy --platform android --release patch --increment-build --dry-run
```

Run the full quality gate and offline consumer smoke test:

```bash
yarn check
yarn package:install-smoke
yarn benchmark --enforce
yarn release:plan --json
```

Releases and npm publications run automatically after the cross-OS CI matrix (Linux, macOS, Windows × Node 22, 24, 26) passes on `main`, using Conventional Commits (`fix:`, `feat:`, `BREAKING CHANGE:`) and npm Trusted Publishing (`--provenance`). See [CONTRIBUTING.md](CONTRIBUTING.md#releases), [CHANGELOG.md](CHANGELOG.md), and [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE) © Nathã Corrêa.
