# Windows CI toolchain

Issue #15, T1.1 and T3.1. The Windows runner already has a Yarn shim in
its global npm prefix. CI installs Corepack 0.36.0 into the job's temporary
directory for Node 26 and puts its executables first on PATH. Audit and
release use the same setup. Each workflow verifies Yarn 3.8.7 before its
immutable install.

The native integration test imports the project module inside the Unix-only
symlink test that uses it. Windows can compile the other tests with the same
Clippy warnings-as-errors setting.

The [CI run for `50effee`](https://github.com/nhcorrea/bump-version-cli/actions/runs/44320961138)
passed all nine jobs across Linux, macOS and Windows on Node 22.23.2, 24.20.0
and 26.13.1. All three Node 26 jobs installed and executed the tarball. The
[Windows smoke](https://github.com/nhcorrea/bump-version-cli/actions/runs/44320961138/job/134859452889#step:9:1)
verified the six-file package after the immutable install and project check.
