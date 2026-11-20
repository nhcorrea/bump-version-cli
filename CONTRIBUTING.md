# Contributing

Contributions are welcome. Keep changes small enough to review, preserve project files byte-for-byte outside intended version values, and add a regression fixture for every supported syntax.

## Prerequisites

- Node.js 26.13.1 LTS for development, matching `.node-version`.
- Corepack 0.36.0 and Yarn 3.8.7.
- rustup and the system linker for your platform. When you run Cargo from the checkout, rustup reads `rust-toolchain.toml` and installs Rust 1.100.0, Clippy, rustfmt and `wasm32-unknown-unknown`. On Windows use the MSVC toolchain with Visual Studio C++ Build Tools.

Consumers need Node.js 22.12.0 or newer and npm.

## Build from a clean checkout

```bash
npm install --global corepack@0.36.0
corepack enable
yarn install --immutable
yarn check
yarn package:install-smoke
```

Cargo builds the same engine for native tests and for Node's WebAssembly runtime. The benchmark runs the published CommonJS entry and requires p95 below 100 ms for `--version` and 150 ms for `inspect`. The complete unpacked npm package, including the compressed Wasm and license notices, must stay below 200,000 bytes and may have at most one direct npm runtime dependency. See the [package measurements](docs/changes/packaged-io-2026-11-18.md) and [hosted CI results](docs/changes/windows-ci-toolchain-2026-11-18.md).

After building, try the candidate as a consumer from an empty directory. These shell commands pack the checkout and run its tarball offline.

```bash
consumer=$(mktemp -d)
archive=$(npm pack --silent --ignore-scripts --pack-destination "$consumer")
(cd "$consumer" && npx --offline --yes --package "./$archive" -- bump-version-cli --version)
```

## Change rules

- Do not introduce a new runtime dependency without measured justification.
- Do not select the first ambiguous version source silently.
- Parsing and transformation belong outside Commander/readline/presentation.
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

The [release workflow](.github/workflows/release.yml) publishes the verified tarball to npm when a matching `v*` tag is pushed. A merge to `main` runs CI.

1. In the npm package settings, confirm the GitHub Actions trusted publisher for owner `nhcorrea`, repository `bump-version-cli`, workflow filename `release.yml` and environment `npm`. Allow direct publishing with `npm publish`. [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/)
2. In GitHub Settings → Environments, configure the `npm` environment to allow release tags matching `v*` if you want to enforce that restriction. GitHub creates a missing environment on its first run with no protection rules. [GitHub deployment environments](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments)
3. Confirm the version in `package.json` and date its entry in `CHANGELOG.md` when cutting the release. Run the clean-checkout checks above, then the following preflight from the repository root.

```bash
release_tag="v$(node -p "require('./package.json').version")"
yarn release:availability
yarn benchmark --enforce
yarn npm audit --all --recursive
yarn release:prepare --verify-only --tag "$release_tag"
```

Once the release changes are on `main` and CI has passed for the intended commit, tag that commit from a clean checkout. Pushing the tag starts publication.

```bash
git tag -a "$release_tag" -m "Release $release_tag"
git push origin "refs/tags/$release_tag"
```

Check the **Release package** run in GitHub Actions, then verify the published version with `npm view @nhcorrea/bump-version-cli@latest version`. If the workflow fails, check that version on npm before retrying. A published version is immutable.
