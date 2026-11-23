# Contributing

Contributions are welcome. Keep changes small enough to review, preserve project files byte-for-byte outside intended version values, and add a regression fixture for every supported syntax.

## Prerequisites

- Node.js 26.13.1 LTS for development, matching `.node-version`.
- Corepack 0.36.0 and Yarn 3.8.7.

Consumers need Node.js 22.12.0 or newer and npm.

## Build from a clean checkout

```bash
npm install --global corepack@0.36.0
corepack enable
yarn install --immutable
yarn check
yarn package:install-smoke
```

`esbuild` bundles the TypeScript CLI into `dist/package/cli.js` with zero third-party runtime dependencies, using Node's built-in `node:util` `parseArgs` and `node:fs` APIs. The benchmark runs the published CommonJS entry and requires p95 below 100 ms for `--version` and 150 ms for `inspect`. The complete unpacked npm package must stay below 100,000 bytes with zero direct npm runtime dependencies. See the [TypeScript engine migration notes](docs/changes/typescript-native-cli-2026-11-23.md).

After building, try the candidate as a consumer from an empty directory. These shell commands pack the checkout and run its tarball offline.

```bash
consumer=$(mktemp -d)
archive=$(npm pack --silent --ignore-scripts --pack-destination "$consumer")
(cd "$consumer" && npx --offline --yes --package "./$archive" -- bump-version-cli --version)
```

## Change rules

- Do not introduce a new runtime dependency without measured justification.
- Do not select the first ambiguous version source silently.
- Parsing and transformation belong outside CLI parsing/readline/presentation.
- Dry-run and commit must use the same `ChangePlan`.
- A no-op must preserve bytes and mtime.
- JSON and exit codes are public API; update contract tests for any intentional change.
- Add fixtures containing only the minimal project syntax needed for the case.
- Never add a real application project or secret to fixtures.

Every logical implementation change must include:

1. `docs/changes/{change}-{YYYY-MM-DD}.md` explaining what changed, why, implementation, plan relation, and validation;
2. an update to `docs/improve-bump-cli-v1/impl-status.md`.

## Pull requests

Include the problem, supported/unsupported behavior, tests, and package/benchmark impact. The CI matrix covers Node 22, 24 and 26 on Linux, macOS and Windows. Node 26 jobs also install and execute the candidate tarball. A release-facing change must also pass the installed-tarball smoke.

Do not publish, tag, or push generated release commits from a pull request.

## Releases

The [release workflow](.github/workflows/release.yml) runs automatically after the [CI workflow](.github/workflows/ci.yml) succeeds for a push to `main`. It computes the next Semantic Version from Conventional Commits since the latest `v*` tag (or releases the prepared initial `1.0.0` when no `v*` tag exists yet):

- `fix:`, `perf:`, `revert:` → `patch` (`1.0.x`)
- `feat:` → `minor` (`1.x.0`)
- `!` suffix or `BREAKING CHANGE:` footer → `major` (`x.0.0`)
- `docs:`, `chore:`, `ci:`, `test:`, `refactor:`, `style:`, `build:` (without breaking markers) → no release

When a release is planned, the workflow synchronizes `package.json` and `CHANGELOG.md`, checks npm version availability, runs `yarn check`, `yarn package:install-smoke`, `yarn benchmark --enforce`, `yarn npm audit --all --recursive` and `yarn release:prepare`, commits the metadata update with `[skip ci]` (when files changed), publishes the verified tarball to npm via Trusted Publishing (`--provenance`), tags `vX.Y.Z`, and creates the GitHub Release with notes and `.release/manifest.json`.

### One-time repository and npm setup

1. In the npm package settings, configure the GitHub Actions trusted publisher for owner `nhcorrea`, repository `bump-version-cli`, workflow filename `release.yml` and environment `npm`. Allow direct publishing with `npm publish`. [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/)
2. In GitHub **Settings → Environments**, create/configure the `npm` environment and allow deployment from branch `main`. [GitHub deployment environments](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments)
3. If `main` has branch protection or a ruleset blocking pushes from `GITHUB_TOKEN`, configure a repository/environment secret named `RELEASE_TOKEN` (a GitHub App token or fine-grained PAT with `Contents: Read and write`) so the workflow can push `chore(release): vX.Y.Z [skip ci]` and tags. Without branch protection blocking Actions, `GITHUB_TOKEN` is used automatically.

### Local release preview

To preview the next automated release locally without modifying files:

```bash
yarn release:plan --json
```

To run the full local preflight against the current checkout:

```bash
release_tag="v$(node -p "require('./package.json').version")"
yarn release:availability
yarn benchmark --enforce
yarn npm audit --all --recursive
yarn release:prepare --verify-only --tag "$release_tag"
```

After a release completes in GitHub Actions, verify the published version with `npm view @nhcorrea/bump-version-cli@latest version`. A published npm version is immutable.
