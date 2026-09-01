# Bump Version CLI

Read, validate, set, and bump Android and iOS app versions from a terminal or CI/CD pipeline.

The CLI is non-interactive by default for its canonical commands, emits stable JSON when requested, plans multi-platform changes before writing, and uses atomic replacement with verification and rollback.

## Requirements

- Node.js `>=22.12.0` (Node 22 and 24 are tested).
- Android or iOS native project files matching the support matrix below.
- No package manager requirement for consumers. Yarn 3.8.7 is used only to develop this repository.

## Install

Local development dependency (recommended for CI and reproducible projects):

```bash
npm install --save-dev @nhcorrea/bump-version-cli
npx bump-version --version
```

Global installation:

```bash
npm install --global @nhcorrea/bump-version-cli
bump-version --version
```

Both `bump-version` and the compatibility alias `bump-version-cli` execute the same binary.

## Quick start

Inspect both native platforms:

```bash
npx bump-version inspect --platform all
```

Plan an exact multi-platform update without writing:

```bash
npx bump-version set \
  --platform all \
  --app-version 1.2.4 \
  --version-code 42 \
  --build-number 42 \
  --dry-run
```

Apply the same change and emit JSON:

```bash
npx bump-version set \
  --platform all \
  --app-version 1.2.4 \
  --version-code 42 \
  --build-number 42 \
  --non-interactive \
  --format json
```

Increment the patch version and both build numbers:

```bash
npx bump-version bump \
  --platform all \
  --release patch \
  --increment-build \
  --non-interactive
```

## Commands

| Command | Purpose | Writes files |
| --- | --- | --- |
| `inspect` | Read current versions and source match counts | No |
| `set` | Set exact marketing versions and build numbers | Yes, unless `--dry-run` |
| `bump` | Increment `major`, `minor`, or `patch` | Yes, unless `--dry-run` |
| `check` | Compare project values with expected values | No |

Run `bump-version <command> --help` for complete options and examples.

### Common options

| Option | Meaning |
| --- | --- |
| `--root <path>` | Project root; defaults to the current directory |
| `--platform android\|ios\|all` | Platform selection; defaults to `all` |
| `--android-file <path>` | Explicit `build.gradle` or `build.gradle.kts` |
| `--android-module <name>` | Android module under `android/`; defaults to `app` |
| `--ios-project <name-or-path>` | `.xcodeproj` name/path or `project.pbxproj` path |
| `--ios-target <name>` | Exact `PBXNativeTarget` name |
| `--ios-configuration <name>` | Exact build configuration inside the selected target(s) |
| `--all-targets` | Explicitly select every native iOS target |
| `--config <path>` | Explicit config file; default discovery is `.bump-version.json` |
| `--format human\|json` | Output format; defaults to `human` |
| `--output-file <path>` | Atomically save the JSON result inside `--root` |
| `--non-interactive` | Explicitly forbid prompts |
| `--dry-run` | Create and validate the same plan without writing (`set`/`bump`) |
| `--debug` | Add internal stack/cause details to stderr |
| `--quiet` | Suppress non-essential diagnostics |
| `--no-color` | Disable color; current canonical output is plain text already |

### Version options

| Option | Field |
| --- | --- |
| `--app-version <x.y.z>` | Android `versionName` and iOS `MARKETING_VERSION` |
| `--version-name <x.y.z>` | Android `versionName` only |
| `--version-code <integer>` | Android `versionCode`, range 1..2,100,000,000 |
| `--marketing-version <x.y.z>` | iOS `MARKETING_VERSION` only |
| `--build-number <integer>` | iOS `CURRENT_PROJECT_VERSION` |
| `--allow-downgrade` | Explicitly allow a lower Android `versionCode` |
| `--release major\|minor\|patch` | Increment policy for `bump` |
| `--increment-build` | Increment platform build numbers during `bump` |

Flags override values from configuration. An omitted build number is never inferred from time or another platform.

## CI/CD

Canonical commands do not prompt and work with stdin closed. `CI=true` also disables legacy interactive commands. JSON goes to stdout; diagnostics and `--debug` go to stderr.

Example GitHub Actions step that updates the working tree and archives a result:

```yaml
- name: Bump native versions
  shell: bash
  run: |
    mkdir -p .artifacts
    npx bump-version bump \
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

The CLI changes project files but does not commit, tag, push, or publish. Keep those actions in explicit protected pipeline steps.

Validate a release version without writing:

```bash
npx bump-version check \
  --platform all \
  --app-version "$RELEASE_VERSION" \
  --format json
```

Do not use `eval` on CLI output. Parse JSON with the pipeline language or a JSON tool.

Projects with multiple iOS targets must add `--ios-target <name>` or the explicit `--all-targets` policy to CI commands.

## JSON schema 1

Success is one JSON document:

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

Errors use the same schema version and a stable textual code:

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

Expected errors include a stable `code`, the relevant path/details and an actionable `hint`. Human output prints the same hint without a stack; `--debug` adds internal stack/cause information to stderr. Fields may be added compatibly to schema 1. Renaming/removing a field requires a new `schemaVersion`.

## Exit codes

| Code | Meaning |
| ---: | --- |
| `0` | Success, dry-run, or idempotent no-op |
| `2` | Invalid/missing argument or value |
| `3` | Root, file, module, or project not found |
| `4` | Unsupported parse, missing field, or ambiguous source |
| `5` | Version conflict, blocked downgrade, or `check` mismatch |
| `6` | Write, verification, or rollback failure |
| `70` | Unexpected internal error |

## Configuration file

An optional `.bump-version.json` can version project defaults:

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

The parser is strict: unknown keys, invalid types, unsupported schema versions, and config paths outside `--root` fail before project files are written.

Precedence is:

1. command-line flags;
2. config file;
3. safe path autodetection.

## Project support

Support is capability-based, not framework-name based.

| Project source | Supported behavior |
| --- | --- |
| Android Groovy | One `defaultConfig`; direct literal `versionCode` and `versionName`; space or `=` syntax; single/double quotes |
| Android Kotlin DSL | One `defaultConfig`; direct literal assignments with `=`; double-quoted `versionName` |
| iOS `.pbxproj` | `PBXNativeTarget`/configuration graph; paired direct literals in `buildSettings`; exact target/configuration or explicit all-target selection |
| React Native CLI | Supported when native Android/iOS files meet the rules above |
| Expo Bare | Supported when local native files are the effective version source and meet the rules above |

Preservation includes whitespace, comments, quote style, semicolons, CRLF/LF, unrelated content, and file mode.

### iOS target and configuration selection

A project with more than one `PBXNativeTarget` is ambiguous by default. Select one target and, optionally, one configuration:

```bash
npx bump-version inspect \
  --platform ios \
  --ios-project App \
  --ios-target App \
  --ios-configuration Release \
  --format json
```

To update every native target, opt in explicitly:

```bash
npx bump-version set \
  --platform ios \
  --all-targets \
  --marketing-version 1.2.4 \
  --build-number 42 \
  --dry-run
```

All selected target/configuration blocks must contain one direct pair and share the same current values. If selected targets are already divergent, update/check each one with `--ios-target` instead of collapsing distinct states silently. An optional `selection` object is included in schema 1 JSON when selectors were supplied.

### Deliberately rejected

- Android flavor/build-type overrides or multiple version assignments;
- Gradle variables, providers, catalogs, or properties as the version source;
- multiple iOS targets without `--ios-target` or `--all-targets`, duplicate names, or divergent blocks inside the selected scope;
- iOS variables/inherited values and versions sourced from `.xcconfig`;
- Expo managed/dynamic app config as a version source;
- EAS remote app version source.

These cases fail with exit `4` instead of overwriting an indirect or ambiguous source. Pass an explicit native file/project only when its contents themselves match the supported policy.

## Write safety

Every mutation follows read-plan-compare-write-verify:

1. read bytes, mode, values, match counts, and SHA-256;
2. validate all selected platforms and build a deterministic `ChangePlan`;
3. recheck the original hash immediately before commit;
4. write a temporary file in the same directory and preserve mode;
5. atomically rename and parse/read back the result;
6. rollback already-applied files if a later target fails.

`--dry-run` uses the exact same plan but never opens the target for writing. A no-op does not change bytes or mtime.

## Legacy commands

The interactive commands remain as deprecated transition aliases:

| Legacy | Replacement |
| --- | --- |
| `android-version` | `inspect --platform android` |
| `ios-version <project>` | `inspect --platform ios --ios-project <project>` |
| `android` | `set --platform android` with explicit flags |
| `ios <project>` | `set --platform ios --ios-project <project>` with explicit flags |

Legacy mutation commands fail fast in CI/`--non-interactive`. See the [v1 migration guide](docs/improve-bump-cli-v1/migration-guide.md).

## Development

This repository intentionally uses Yarn 3.8.7:

```bash
corepack yarn@3.8.7 install --immutable
corepack yarn@3.8.7 check
corepack yarn@3.8.7 benchmark
corepack yarn@3.8.7 package:install-smoke
```

See [CONTRIBUTING.md](CONTRIBUTING.md), [CHANGELOG.md](CHANGELOG.md), and [SECURITY.md](SECURITY.md). Maintainers should follow the [release runbook](docs/improve-bump-cli-v1/release-runbook.md); publishing is intentionally restricted to the protected tag workflow.

## License

[MIT](LICENSE) © Nathã Corrêa.
