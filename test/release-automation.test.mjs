import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  bumpSemver,
  compareSemver,
  extractChangelogSection,
  formatReleaseNotes,
  parseConventionalCommit,
  planRelease,
  updateChangelog,
  updatePackageJsonVersion,
} from "../scripts/release-commits.mjs";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(testDirectory, "..");
const repoUrl = "https://github.com/nhcorrea/bump-version-cli";

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function git(cwd, args) {
  return execFileSync("git", ["-c", "core.autocrlf=false", ...args], {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Test Bot",
      GIT_AUTHOR_EMAIL: "test@example.com",
      GIT_COMMITTER_NAME: "Test Bot",
      GIT_COMMITTER_EMAIL: "test@example.com",
    },
  }).trim();
}

test("parses conventional commits and breaking changes", () => {
  assert.equal(
    parseConventionalCommit({ subject: "fix(ios): preserve terminator" }).bump,
    "patch"
  );
  assert.equal(
    parseConventionalCommit({ subject: "perf: avoid extra read" }).bump,
    "patch"
  );
  assert.equal(
    parseConventionalCommit({ subject: 'Revert "feat: add flag"' }).bump,
    "patch"
  );
  assert.equal(
    parseConventionalCommit({ subject: "feat(android): support kts" }).bump,
    "minor"
  );
  assert.equal(
    parseConventionalCommit({ subject: "feat!: drop Node 20" }).bump,
    "major"
  );
  assert.equal(
    parseConventionalCommit({
      subject: "refactor(core): change output shape",
      body: "More context\n\nBREAKING CHANGE: output schema is now v2",
    }).bump,
    "major"
  );
  assert.equal(
    parseConventionalCommit({ subject: "docs: update readme" }).bump,
    "none"
  );
  assert.equal(
    parseConventionalCommit({ subject: "ci: speed up matrix" }).bump,
    "none"
  );
  assert.equal(
    parseConventionalCommit({
      subject: "chore(release): v1.0.1 [skip ci]",
    }).ignored,
    true
  );
});

test("compares and bumps semantic versions", () => {
  assert.equal(compareSemver("1.2.10", "1.2.2") > 0, true);
  assert.equal(compareSemver("1.0.0", "1.0.0"), 0);
  assert.equal(bumpSemver("1.2.3", "patch"), "1.2.4");
  assert.equal(bumpSemver("1.2.3", "minor"), "1.3.0");
  assert.equal(bumpSemver("1.2.3", "major"), "2.0.0");
});

test("plans initial 1.0.0 release using curated changelog notes without double bumping", () => {
  const changelog = readFileSync(join(repositoryRoot, "CHANGELOG.md"), "utf8");
  const plan = planRelease({
    currentVersion: "1.0.0",
    latestTag: null,
    commits: [
      { hash: "aaaaaaa1111111", subject: "docs: prepare npm release v1.0.0" },
      { hash: "bbbbbbb2222222", subject: "feat: ship v1 CLI" },
    ],
    existingChangelog: changelog,
    repoUrl,
  });

  assert.equal(plan.shouldRelease, true);
  assert.equal(plan.bump, "initial");
  assert.equal(plan.version, "1.0.0");
  assert.equal(plan.tag, "v1.0.0");
  assert.equal(plan.updateFiles, false);
  assert.match(plan.notes, /### Added/);
  assert.match(plan.notes, /Node `>=22\.12\.0`/);
});

test("plans patch, minor, major, no-op, and resumed releases after v1.0.0", () => {
  const noRelease = planRelease({
    currentVersion: "1.0.0",
    latestTag: "v1.0.0",
    commits: [
      { hash: "1111111aaaaaaa", subject: "docs: clarify CI examples" },
      { hash: "2222222bbbbbbb", subject: "test: add fixture" },
    ],
    repoUrl,
  });
  assert.equal(noRelease.shouldRelease, false);
  assert.equal(noRelease.bump, "none");

  const minor = planRelease({
    currentVersion: "1.0.0",
    latestTag: "v1.0.0",
    commits: [
      { hash: "3333333ccccccc", subject: "fix(ios): trim whitespace" },
      { hash: "4444444ddddddd", subject: "feat(android): add catalog hint" },
    ],
    repoUrl,
  });
  assert.equal(minor.shouldRelease, true);
  assert.equal(minor.bump, "minor");
  assert.equal(minor.version, "1.1.0");
  assert.equal(minor.tag, "v1.1.0");
  assert.match(minor.notes, /### Features/);
  assert.match(minor.notes, /### Bug Fixes/);
  assert.match(minor.notes, /\*\*android:\*\* add catalog hint/);

  const major = planRelease({
    currentVersion: "1.1.0",
    latestTag: "v1.1.0",
    commits: [
      {
        hash: "5555555eeeeeee",
        subject: "feat!: remove legacy interactive commands",
      },
    ],
    repoUrl,
  });
  assert.equal(major.shouldRelease, true);
  assert.equal(major.bump, "major");
  assert.equal(major.version, "2.0.0");
  assert.match(major.notes, /### Breaking Changes/);

  const resumed = planRelease({
    currentVersion: "1.1.0",
    latestTag: "v1.0.0",
    commits: [
      { hash: "6666666fffffff", subject: "chore(release): v1.1.0 [skip ci]" },
      { hash: "4444444ddddddd", subject: "feat(android): add catalog hint" },
    ],
    existingChangelog:
      "# Changelog\n\n## [Unreleased]\n\n## [1.1.0] - 2026-11-22\n\n### Features\n\n- add catalog hint\n",
    repoUrl,
  });
  assert.equal(resumed.shouldRelease, true);
  assert.equal(resumed.bump, "resume");
  assert.equal(resumed.version, "1.1.0");
  assert.equal(resumed.updateFiles, false);
  assert.match(resumed.notes, /add catalog hint/);
});

test("updates package.json and CHANGELOG.md cleanly and idempotently", () => {
  const pkg = readFileSync(join(repositoryRoot, "package.json"), "utf8");
  const changelog = readFileSync(join(repositoryRoot, "CHANGELOG.md"), "utf8");
  const currentVersion = JSON.parse(pkg).version;
  const previousTag = `v${currentVersion}`;
  const nextVersion = bumpSemver(currentVersion, "minor");
  const nextTag = `v${nextVersion}`;

  const nextPkg = updatePackageJsonVersion(pkg, nextVersion);
  assert.equal(JSON.parse(nextPkg).version, nextVersion);

  const notes = formatReleaseNotes(
    [
      parseConventionalCommit({
        hash: "1234567890abcdef",
        subject: "feat(cli): add automated releases",
      }),
    ],
    { repoUrl }
  );
  const nextChangelog = updateChangelog(changelog, {
    version: nextVersion,
    date: "2026-11-22",
    notes,
    previousTag,
    repoUrl,
  });

  assert.match(
    nextChangelog,
    new RegExp(
      `## \\[Unreleased\\]\\r?\\n\\r?\\n## \\[${escapeRegExp(nextVersion)}\\] - 2026-11-22\\r?\\n\\r?\\n### Features`
    )
  );
  assert.match(
    nextChangelog,
    new RegExp(
      `\\[Unreleased\\]: ${escapeRegExp(repoUrl)}/compare/${escapeRegExp(nextTag)}\\.\\.\\.HEAD`
    )
  );
  assert.match(
    nextChangelog,
    new RegExp(
      `\\[${escapeRegExp(nextVersion)}\\]: ${escapeRegExp(repoUrl)}/compare/${escapeRegExp(previousTag)}\\.\\.\\.${escapeRegExp(nextTag)}`
    )
  );
  assert.equal(extractChangelogSection(nextChangelog, nextVersion), notes);
  assert.equal(
    updateChangelog(nextChangelog, {
      version: nextVersion,
      date: "2026-11-22",
      notes,
      previousTag,
      repoUrl,
    }),
    nextChangelog
  );
});

test("release-plan and release-sync work end-to-end in a temporary git repository", () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "bump-version-release-auto-"));
  try {
    copyFileSync(
      join(repositoryRoot, "package.json"),
      join(tempRoot, "package.json")
    );
    copyFileSync(
      join(repositoryRoot, "CHANGELOG.md"),
      join(tempRoot, "CHANGELOG.md")
    );
    const currentVersion = JSON.parse(
      readFileSync(join(tempRoot, "package.json"), "utf8")
    ).version;
    const currentTag = `v${currentVersion}`;
    const nextVersion = bumpSemver(currentVersion, "patch");
    const nextTag = `v${nextVersion}`;

    git(tempRoot, ["init", "-b", "main"]);
    git(tempRoot, ["add", "."]);
    git(tempRoot, ["commit", "-m", "feat: initial v1 release"]);
    git(tempRoot, ["tag", "-a", currentTag, "-m", `Release ${currentTag}`]);

    writeFileSync(join(tempRoot, "note.txt"), "fix\n", "utf8");
    git(tempRoot, ["add", "note.txt"]);
    git(tempRoot, ["commit", "-m", "fix(android): handle trailing space"]);

    const githubOutput = join(tempRoot, "github-output.txt");
    const notesFile = join(tempRoot, "notes.md");

    const planJson = execFileSync(
      process.execPath,
      [
        join(repositoryRoot, "scripts", "release-plan.mjs"),
        "--cwd",
        tempRoot,
        "--json",
        "--github-output",
        githubOutput,
        "--notes-file",
        notesFile,
      ],
      { encoding: "utf8" }
    );
    const plan = JSON.parse(planJson);
    assert.equal(plan.shouldRelease, true);
    assert.equal(plan.version, nextVersion);
    assert.equal(plan.tag, nextTag);
    assert.equal(plan.previousTag, currentTag);

    const outputText = readFileSync(githubOutput, "utf8");
    assert.match(outputText, /^should_release=true$/m);
    assert.match(
      outputText,
      new RegExp(`^version=${escapeRegExp(nextVersion)}$`, "m")
    );
    assert.match(
      outputText,
      new RegExp(`^tag=${escapeRegExp(nextTag)}$`, "m")
    );

    execFileSync(
      process.execPath,
      [
        join(repositoryRoot, "scripts", "release-sync.mjs"),
        "--cwd",
        tempRoot,
        "--version",
        plan.version,
        "--previous-tag",
        plan.previousTag,
        "--notes-file",
        notesFile,
        "--date",
        "2026-11-22",
      ],
      { encoding: "utf8" }
    );

    assert.equal(
      JSON.parse(readFileSync(join(tempRoot, "package.json"), "utf8")).version,
      nextVersion
    );
    assert.match(
      readFileSync(join(tempRoot, "CHANGELOG.md"), "utf8"),
      new RegExp(`## \\[${escapeRegExp(nextVersion)}\\] - 2026-11-22`)
    );

    // A non-matching --verify-head-matches skips a superseded run cleanly.
    const previousHead = git(tempRoot, ["rev-parse", "HEAD~1"]);
    const skipped = JSON.parse(
      execFileSync(
        process.execPath,
        [
          join(repositoryRoot, "scripts", "release-plan.mjs"),
          "--cwd",
          tempRoot,
          "--ref",
          previousHead,
          "--verify-head-matches",
          "HEAD",
          "--json",
        ],
        { encoding: "utf8" }
      )
    );
    assert.equal(skipped.shouldRelease, false);
    assert.match(skipped.reason, /superseded/);
  } finally {
    rmSync(tempRoot, { force: true, recursive: true });
  }
});
