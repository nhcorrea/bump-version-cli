# Rust in the npm tarball

Issue #15, T3. Node instantiates a single Rust WebAssembly module and supplies
synchronous filesystem calls. The Brotli stream expands only in memory. The
CommonJS entry retains Commander, the original prompts and the injectable
runtime. Cargo, TypeScript, native platform packages, lifecycle downloads and
runtime npm dependencies are unnecessary for consumers.

The benchmark and characterization suite use the published entry. The smoke
uses an empty offline npm cache and exercises local, temporary global and
standalone installations. Release verification runs it against the exact
tarball after checking integrity.

macOS arm64, Node 26.13.1, 20 iterations before the documentation update:
version p95 44.62 ms, inspect p95 54.93 ms, 184,962 unpacked bytes and zero
runtime dependencies. The 100,000-byte limit fails and remains in force.
Independent install smokes passed on Node 22.12.0, 22.23.2, 24.20.0 and
26.13.1 on macOS. Linux and Windows results are pending.

A second build verification found absolute Cargo registry paths in Rust panic
locations. The build now maps local directories to virtual roots before
compiling. The packed-file checks accept only the CLI, Rust module and notices
under dist. The documentation note records the revised measurement.
