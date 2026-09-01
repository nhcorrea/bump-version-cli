import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnCommandSync } from "./spawn-command.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "..");
const cliPath = join(repositoryRoot, "dist", "cli.js");
const fixtureRoot = join(repositoryRoot, "test", "fixtures", "android-groovy");
const packageJson = JSON.parse(
  readFileSync(join(repositoryRoot, "package.json"), "utf8")
);
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const benchmarkRoot = mkdtempSync(join(tmpdir(), "bump-version-benchmark-"));
const npmCache = join(benchmarkRoot, "npm-cache");
const iterationIndex = process.argv.indexOf("--iterations");
const iterations =
  iterationIndex >= 0 ? Number(process.argv[iterationIndex + 1]) : 20;
const enforce = process.argv.includes("--enforce");
const json = process.argv.includes("--json");

process.on("exit", () => {
  rmSync(benchmarkRoot, { force: true, recursive: true });
});

if (!Number.isSafeInteger(iterations) || iterations < 5 || iterations > 200) {
  throw new Error("--iterations must be an integer between 5 and 200.");
}

function runCli(args) {
  const started = process.hrtime.bigint();
  const result = spawnCommandSync(process.execPath, [cliPath, ...args], {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      CI: "true",
      NO_COLOR: "1",
    },
  });
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1_000_000;

  if (result.status !== 0) {
    throw new Error(
      `Benchmark command failed: ${result.stderr || result.stdout}`
    );
  }

  return { elapsedMs, stdout: result.stdout };
}

function percentile(samples, fraction) {
  const sorted = [...samples].sort((left, right) => left - right);
  return sorted[Math.ceil(sorted.length * fraction) - 1];
}

function measure(args, validate) {
  for (let warmup = 0; warmup < 3; warmup += 1) {
    validate(runCli(args).stdout);
  }

  const samples = [];

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const result = runCli(args);
    validate(result.stdout);
    samples.push(result.elapsedMs);
  }

  return {
    p50Ms: Number(percentile(samples, 0.5).toFixed(2)),
    p95Ms: Number(percentile(samples, 0.95).toFixed(2)),
    maxMs: Number(Math.max(...samples).toFixed(2)),
  };
}

const version = measure(["--version"], (stdout) => {
  if (stdout !== `${packageJson.version}\n`) {
    throw new Error("--version output changed during the benchmark.");
  }
});
const inspect = measure(
  [
    "inspect",
    "--platform",
    "android",
    "--root",
    fixtureRoot,
    "--format",
    "json",
  ],
  (stdout) => {
    const document = JSON.parse(stdout);

    if (document.ok !== true || document.command !== "inspect") {
      throw new Error("inspect output changed during the benchmark.");
    }
  }
);
const pack = spawnCommandSync(
  npmCommand,
  ["pack", "--json", "--dry-run", "--ignore-scripts"],
  {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      npm_config_cache: npmCache,
    },
  }
);

if (pack.status !== 0) {
  throw new Error(`npm pack failed: ${pack.stderr || pack.stdout}`);
}

const [manifest] = JSON.parse(pack.stdout);
const unpackedBytes = manifest.unpackedSize ?? manifest.size;
const directRuntimeDependencies = Object.keys(
  packageJson.dependencies ?? {}
).length;
const budgets = {
  versionP95Ms: 100,
  inspectP95Ms: 150,
  unpackedBytes: 100_000,
  directRuntimeDependencies: 1,
};
const checks = {
  version: version.p95Ms < budgets.versionP95Ms,
  inspect: inspect.p95Ms < budgets.inspectP95Ms,
  package: unpackedBytes < budgets.unpackedBytes,
  dependencies: directRuntimeDependencies <= budgets.directRuntimeDependencies,
};
const report = {
  schemaVersion: 1,
  node: process.version,
  iterations,
  version,
  inspect,
  package: {
    unpackedBytes,
    directRuntimeDependencies,
  },
  budgets,
  checks,
  ok: Object.values(checks).every(Boolean),
};

if (json) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} else {
  process.stdout.write(
    [
      `Performance benchmark (${iterations} iterations, ${process.version})`,
      `--version p95: ${version.p95Ms} ms (budget < ${budgets.versionP95Ms} ms)`,
      `inspect p95: ${inspect.p95Ms} ms (budget < ${budgets.inspectP95Ms} ms)`,
      `package: ${unpackedBytes} bytes unpacked (budget < ${budgets.unpackedBytes})`,
      `runtime dependencies: ${directRuntimeDependencies} (budget <= ${budgets.directRuntimeDependencies})`,
      `result: ${report.ok ? "PASS" : "FAIL"}`,
      "",
    ].join("\n")
  );
}

if (enforce && !report.ok) {
  process.exitCode = 1;
}
