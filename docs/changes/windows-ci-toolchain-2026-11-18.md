# Windows CI toolchain

Issue #15, T1.1 and T3.1. The Windows runner already has a Yarn shim in
its global npm prefix. CI installs Corepack 0.36.0 into the job's temporary
directory for Node 26 and puts its executables first on PATH. Audit and
release use the same setup. Each workflow verifies Yarn 3.8.7 before its
immutable install.

The native integration test imports the project module inside the Unix-only
symlink test that uses it. Windows can compile the other tests with the same
Clippy warnings-as-errors setting. The Node 26 jobs install the packed tarball
on all three operating systems. Results are available in the [PR checks](https://github.com/nhcorrea/bump-version-cli/pull/16/checks).
