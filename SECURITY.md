# Security Policy

## Supported versions

Security fixes are applied to the latest `1.x` release and the current `main` branch. Pre-1.0 snapshots are not supported.

## Reporting a vulnerability

Please do not disclose exploitable details in a public issue.

Use the repository's GitHub Security tab to submit a private vulnerability report when available. If private reporting is unavailable, open a minimal issue requesting a private contact channel without including proof-of-concept, affected paths, secrets, or user data.

Include, privately:

- affected version/commit and operating system;
- impact and prerequisites;
- minimal reproduction using synthetic files;
- whether root confinement, symlinks, temporary files, rollback, CI output, or package installation is involved;
- any suggested mitigation.

The maintainer will acknowledge a valid report, assess severity, and coordinate a fix/release before public disclosure. No guaranteed response-time SLA is offered for this pre-v1 project.

## Scope

High-priority areas include path traversal, symlink handling, partial multi-file writes, unsafe temporary files, command execution, secret leakage in JSON/debug output, and release supply-chain compromise.

The CLI must not execute Gradle/Xcode project code or make network requests during version inspection/update.
