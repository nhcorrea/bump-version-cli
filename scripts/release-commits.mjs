import assert from "node:assert/strict";

const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const CONVENTIONAL_HEADER_PATTERN =
  /^(?<type>[a-zA-Z]+)(?:\((?<scope>[^()\r\n]+)\))?(?<breaking>!)?:\s+(?<description>.+)$/;
const GIT_REVERT_PATTERN = /^Revert\s+"(.+)"$/;
const BREAKING_FOOTER_PATTERN = /^BREAKING[ -]CHANGE:\s*(.+)$/gm;
const RELEASE_COMMIT_PATTERN = /^chore\(release\):\s*/i;

const BUMP_RANK = {
  none: 0,
  patch: 1,
  minor: 2,
  major: 3,
};

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function parseSemver(version) {
  const match = SEMVER_PATTERN.exec(String(version ?? "").trim());
  assert.ok(match, `Invalid semantic version: ${version}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function isValidSemver(version) {
  return SEMVER_PATTERN.test(String(version ?? "").trim());
}

export function compareSemver(left, right) {
  const a = parseSemver(left);
  const b = parseSemver(right);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) {
      return a[index] - b[index];
    }
  }
  return 0;
}

export function bumpSemver(version, bump) {
  const [major, minor, patch] = parseSemver(version);
  if (bump === "major") {
    return `${major + 1}.0.0`;
  }
  if (bump === "minor") {
    return `${major}.${minor + 1}.0`;
  }
  if (bump === "patch") {
    return `${major}.${minor}.${patch + 1}`;
  }
  throw new Error(`Unsupported release bump type: ${bump}`);
}

export function parseConventionalCommit({ hash = "", subject = "", body = "" }) {
  const trimmedSubject = subject.trim();
  const normalizedBody = body.replaceAll("\r\n", "\n");

  if (RELEASE_COMMIT_PATTERN.test(trimmedSubject)) {
    return {
      hash,
      subject: trimmedSubject,
      type: "chore",
      scope: "release",
      description: trimmedSubject.replace(RELEASE_COMMIT_PATTERN, "").trim(),
      breaking: false,
      breakingNotes: [],
      bump: "none",
      ignored: true,
    };
  }

  const breakingNotes = [];
  for (const match of normalizedBody.matchAll(BREAKING_FOOTER_PATTERN)) {
    const note = match[1].trim();
    if (note) {
      breakingNotes.push(note);
    }
  }

  if (GIT_REVERT_PATTERN.test(trimmedSubject)) {
    const breaking = breakingNotes.length > 0;
    return {
      hash,
      subject: trimmedSubject,
      type: "revert",
      scope: null,
      description: trimmedSubject,
      breaking,
      breakingNotes,
      bump: breaking ? "major" : "patch",
      ignored: false,
    };
  }

  const match = CONVENTIONAL_HEADER_PATTERN.exec(trimmedSubject);
  if (!match) {
    const breaking = breakingNotes.length > 0;
    return {
      hash,
      subject: trimmedSubject,
      type: null,
      scope: null,
      description: trimmedSubject,
      breaking,
      breakingNotes,
      bump: breaking ? "major" : "none",
      ignored: false,
    };
  }

  const type = match.groups.type.toLowerCase();
  const scope = match.groups.scope?.trim() || null;
  const description = match.groups.description.trim();
  const breaking = Boolean(match.groups.breaking) || breakingNotes.length > 0;

  let bump = "none";
  if (breaking) {
    bump = "major";
  } else if (type === "feat") {
    bump = "minor";
  } else if (type === "fix" || type === "perf" || type === "revert") {
    bump = "patch";
  }

  return {
    hash,
    subject: trimmedSubject,
    type,
    scope,
    description,
    breaking,
    breakingNotes,
    bump,
    ignored: false,
  };
}

function formatCommitBullet(commit, description, repoUrl) {
  const scopePrefix = commit.scope ? `**${commit.scope}:** ` : "";
  const shortHash = commit.hash ? commit.hash.slice(0, 7) : "";
  const link =
    shortHash && repoUrl
      ? ` ([\`${shortHash}\`](${repoUrl}/commit/${commit.hash}))`
      : shortHash
        ? ` (\`${shortHash}\`)`
        : "";
  return `- ${scopePrefix}${description}${link}`;
}

export function formatReleaseNotes(parsedCommits, { repoUrl = "" } = {}) {
  const cleanRepoUrl = repoUrl.replace(/\/+$/, "");
  const sections = [
    { title: "Breaking Changes", items: [] },
    { title: "Features", items: [] },
    { title: "Bug Fixes", items: [] },
    { title: "Performance Improvements", items: [] },
    { title: "Reverts", items: [] },
  ];

  for (const commit of parsedCommits) {
    if (commit.ignored) {
      continue;
    }

    if (commit.breaking) {
      if (commit.breakingNotes.length > 0) {
        for (const note of commit.breakingNotes) {
          sections[0].items.push(
            formatCommitBullet(commit, note, cleanRepoUrl)
          );
        }
      } else {
        sections[0].items.push(
          formatCommitBullet(commit, commit.description, cleanRepoUrl)
        );
      }
    }

    if (commit.type === "feat") {
      sections[1].items.push(
        formatCommitBullet(commit, commit.description, cleanRepoUrl)
      );
    } else if (commit.type === "fix") {
      sections[2].items.push(
        formatCommitBullet(commit, commit.description, cleanRepoUrl)
      );
    } else if (commit.type === "perf") {
      sections[3].items.push(
        formatCommitBullet(commit, commit.description, cleanRepoUrl)
      );
    } else if (commit.type === "revert") {
      sections[4].items.push(
        formatCommitBullet(commit, commit.description, cleanRepoUrl)
      );
    }
  }

  return sections
    .filter((section) => section.items.length > 0)
    .map((section) => `### ${section.title}\n\n${section.items.join("\n")}`)
    .join("\n\n");
}

export function extractChangelogSection(changelog, version) {
  const normalized = String(changelog ?? "").replaceAll("\r\n", "\n");
  const pattern = new RegExp(
    `(?:^|\\n)## \\[${escapeRegExp(version)}\\][^\\n]*\\n([\\s\\S]*?)(?=\\n## \\[|\\n\\[[^\\]]+\\]:\\s+https?:\\/\\/|$)`
  );
  const match = pattern.exec(normalized);
  if (!match) {
    return null;
  }
  const body = match[1].trim();
  return body.length > 0 ? body : null;
}

export function updateChangelog(
  changelog,
  { version, date, notes, previousTag = null, repoUrl = "" }
) {
  parseSemver(version);
  const usesCrlf = changelog.includes("\r\n");
  const normalized = changelog.replaceAll("\r\n", "\n");

  if (
    new RegExp(`^## \\[${escapeRegExp(version)}\\]`, "m").test(normalized)
  ) {
    return changelog;
  }

  const unreleasedHeader = /^## \[Unreleased\][ \t]*\n/m;
  assert.match(
    normalized,
    unreleasedHeader,
    "CHANGELOG.md must contain a '## [Unreleased]' heading"
  );

  const trimmedNotes = notes.trim();
  const entry = `\n## [${version}] - ${date}\n\n${trimmedNotes}\n`;
  let updated = normalized.replace(
    unreleasedHeader,
    (match) => `${match}${entry}`
  );

  const cleanRepoUrl = repoUrl.replace(/\/+$/, "");
  if (cleanRepoUrl) {
    const versionLink = previousTag
      ? `[${version}]: ${cleanRepoUrl}/compare/${previousTag}...v${version}`
      : `[${version}]: ${cleanRepoUrl}/releases/tag/v${version}`;
    const unreleasedLinkPattern = /^\[Unreleased\]:\s+\S+$/m;
    const nextUnreleasedLink = `[Unreleased]: ${cleanRepoUrl}/compare/v${version}...HEAD`;

    if (unreleasedLinkPattern.test(updated)) {
      updated = updated.replace(
        unreleasedLinkPattern,
        `${nextUnreleasedLink}\n${versionLink}`
      );
    } else {
      updated = `${updated.trimEnd()}\n\n${nextUnreleasedLink}\n${versionLink}\n`;
    }
  }

  return usesCrlf ? updated.replaceAll("\n", "\r\n") : updated;
}

export function planRelease({
  currentVersion,
  latestTag = null,
  commits = [],
  existingChangelog = "",
  repoUrl = "",
}) {
  parseSemver(currentVersion);
  const parsedCommits = commits.map(parseConventionalCommit);

  let highestBump = "none";
  for (const commit of parsedCommits) {
    if (BUMP_RANK[commit.bump] > BUMP_RANK[highestBump]) {
      highestBump = commit.bump;
    }
  }

  if (!latestTag) {
    const existingNotes = extractChangelogSection(
      existingChangelog,
      currentVersion
    );

    if (highestBump === "none" && !existingNotes) {
      return {
        shouldRelease: false,
        reason: "No releasable conventional commits found.",
        currentVersion,
        latestTag: null,
        bump: "none",
        version: null,
        tag: null,
        previousTag: null,
        notes: "",
        updateFiles: false,
      };
    }

    const generatedNotes = formatReleaseNotes(parsedCommits, { repoUrl });
    return {
      shouldRelease: true,
      reason: existingNotes
        ? `Initial release v${currentVersion} is prepared in package.json and CHANGELOG.md.`
        : `Initial release v${currentVersion} computed from conventional commits.`,
      currentVersion,
      latestTag: null,
      bump: "initial",
      version: currentVersion,
      tag: `v${currentVersion}`,
      previousTag: null,
      notes: existingNotes || generatedNotes || `Release v${currentVersion}.`,
      updateFiles: !existingNotes,
    };
  }

  assert.ok(
    latestTag.startsWith("v") && isValidSemver(latestTag.slice(1)),
    `Invalid latest release tag: ${latestTag}`
  );
  const baseVersion = latestTag.slice(1);

  if (
    compareSemver(currentVersion, baseVersion) > 0 &&
    commits.length > 0 &&
    new RegExp(
      `^chore\\(release\\):\\s*v?${escapeRegExp(currentVersion)}\\b`,
      "i"
    ).test(commits[0].subject.trim())
  ) {
    const existingNotes = extractChangelogSection(
      existingChangelog,
      currentVersion
    );
    return {
      shouldRelease: true,
      reason: `Resuming unpublished release commit for v${currentVersion}.`,
      currentVersion,
      latestTag,
      bump: "resume",
      version: currentVersion,
      tag: `v${currentVersion}`,
      previousTag: latestTag,
      notes:
        existingNotes ||
        formatReleaseNotes(parsedCommits, { repoUrl }) ||
        `Release v${currentVersion}.`,
      updateFiles: false,
    };
  }

  if (highestBump === "none") {
    return {
      shouldRelease: false,
      reason: `No releasable conventional commits since ${latestTag}.`,
      currentVersion,
      latestTag,
      bump: "none",
      version: null,
      tag: null,
      previousTag: latestTag,
      notes: "",
      updateFiles: false,
    };
  }

  const nextVersion = bumpSemver(baseVersion, highestBump);
  const notes = formatReleaseNotes(parsedCommits, { repoUrl });
  return {
    shouldRelease: true,
    reason: `Computed ${highestBump} release v${nextVersion} from conventional commits since ${latestTag}.`,
    currentVersion,
    latestTag,
    bump: highestBump,
    version: nextVersion,
    tag: `v${nextVersion}`,
    previousTag: latestTag,
    notes: notes || `Release v${nextVersion}.`,
    updateFiles: true,
  };
}

export function updatePackageJsonVersion(text, version) {
  parseSemver(version);
  const versionPattern = /^(\s*"version"\s*:\s*")([^"]+)(")/m;
  assert.match(
    text,
    versionPattern,
    'package.json must contain a "version" field'
  );
  const updated = text.replace(versionPattern, `$1${version}$3`);
  const parsed = JSON.parse(updated);
  assert.equal(parsed.version, version);
  return updated;
}

export function updateCargoTomlVersion(text, version) {
  parseSemver(version);
  const usesCrlf = text.includes("\r\n");
  const normalized = text.replaceAll("\r\n", "\n");
  const packageSectionPattern =
    /(?:^|\n)(\[package\][ \t]*\n([\s\S]*?))(?=\n\[|$)/;
  const sectionMatch = packageSectionPattern.exec(normalized);
  assert.ok(sectionMatch, "Cargo.toml must contain a [package] section");

  const sectionText = sectionMatch[1];
  const sectionBody = sectionMatch[2];
  const sectionStart =
    sectionMatch.index + (sectionMatch[0].startsWith("\n") ? 1 : 0);

  const versionMatches = [
    ...sectionBody.matchAll(/^version\s*=\s*"([^"]+)"/gm),
  ];
  assert.equal(
    versionMatches.length,
    1,
    "Cargo.toml [package] section must contain exactly one version field"
  );

  const updatedSection = sectionText.replace(
    /^(version\s*=\s*")([^"]+)(")/m,
    `$1${version}$3`
  );
  const updated =
    normalized.slice(0, sectionStart) +
    updatedSection +
    normalized.slice(sectionStart + sectionText.length);

  return usesCrlf ? updated.replaceAll("\n", "\r\n") : updated;
}

export function updateCargoLockVersion(text, packageName, version) {
  parseSemver(version);
  const usesCrlf = text.includes("\r\n");
  const normalized = text.replaceAll("\r\n", "\n");
  const blockPattern = /\[\[package\]\]\n[\s\S]*?(?=\n\[\[package\]\]|$)/g;
  const namePattern = new RegExp(
    `^name\\s*=\\s*"${escapeRegExp(packageName)}"$`,
    "m"
  );
  const sourcePattern = /^source\s*=/m;
  const versionPattern = /^(version\s*=\s*")([^"]+)(")$/m;

  let matchCount = 0;
  const updated = normalized.replace(blockPattern, (block) => {
    if (!namePattern.test(block) || sourcePattern.test(block)) {
      return block;
    }
    matchCount += 1;
    assert.match(
      block,
      versionPattern,
      `Cargo.lock entry for ${packageName} is missing a version field`
    );
    return block.replace(versionPattern, `$1${version}$3`);
  });

  assert.equal(
    matchCount,
    1,
    `Cargo.lock must contain exactly one local package entry for ${packageName}; found ${matchCount}`
  );

  return usesCrlf ? updated.replaceAll("\n", "\r\n") : updated;
}
