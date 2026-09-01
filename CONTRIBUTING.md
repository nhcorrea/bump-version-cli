# Contributing

Contributions are welcome. Keep changes small enough to review, preserve project files byte-for-byte outside intended version values, and add a regression fixture for every supported syntax.

## Prerequisites

- Node.js 22.12 or newer (Node 22 is the compile baseline; Node 24 is also tested).
- Corepack.
- Yarn exactly 3.8.7 for this repository.

## Setup

```bash
corepack yarn@3.8.7 install --immutable
corepack yarn@3.8.7 check
```

Useful commands:

```bash
corepack yarn@3.8.7 typecheck
corepack yarn@3.8.7 test
corepack yarn@3.8.7 package:smoke
corepack yarn@3.8.7 package:install-smoke
corepack yarn@3.8.7 benchmark
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

Include the problem, supported/unsupported behavior, tests, and package/benchmark impact. The CI matrix runs Node 22 and 24 on Linux, macOS, and Windows. A release-facing change must also pass the installed-tarball smoke.

Do not publish, tag, or push generated release commits from a pull request.

## Releases

Publishing is performed only by the protected `release.yml` tag workflow with npm trusted publishing. Do not add an npm write token or run `yarn npm publish` manually. Follow the [release runbook](docs/improve-bump-cli-v1/release-runbook.md) for prerequisites, gates, tag rules, and recovery.
