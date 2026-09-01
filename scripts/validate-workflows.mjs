import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "..");
const workflowDirectory = join(repositoryRoot, ".github", "workflows");
const workflowFiles = readdirSync(workflowDirectory)
  .filter((file) => file.endsWith(".yml") || file.endsWith(".yaml"))
  .sort();

assert.ok(workflowFiles.length > 0, "no GitHub Actions workflows found");

for (const workflowFile of workflowFiles) {
  const workflow = readFileSync(join(workflowDirectory, workflowFile), "utf8");

  assert.doesNotMatch(
    workflow,
    /^\s*pull_request_target\s*:/m,
    `${workflowFile} must not execute pull_request_target code`
  );
  assert.match(
    workflow,
    /^permissions:\s*$/m,
    `${workflowFile} must declare explicit permissions`
  );

  for (const match of workflow.matchAll(/^\s*uses:\s*([^\s#]+)/gm)) {
    const action = match[1];

    if (action.startsWith("./")) {
      continue;
    }

    assert.match(
      action,
      /^[^/\s]+\/[^@\s]+@[0-9a-f]{40}$/,
      `${workflowFile} action is not pinned to a full commit SHA: ${action}`
    );
  }

  if (workflowFile === "release.yml") {
    assert.match(workflow, /^\s+id-token:\s+write\s*$/m);
    assert.match(workflow, /^\s+environment:\s+npm\s*$/m);
    assert.match(workflow, /^\s+package-manager-cache:\s+false\s*$/m);
    assert.match(
      workflow,
      /npm publish \.release\/package\.tgz --ignore-scripts/
    );
    assert.match(workflow, /yarn benchmark --enforce/);
    assert.match(workflow, /yarn release:availability/);
    assert.doesNotMatch(workflow, /NODE_AUTH_TOKEN/);
    assert.doesNotMatch(workflow, /^\s+workflow_dispatch\s*:/m);
  } else {
    assert.doesNotMatch(
      workflow,
      /^\s+id-token:\s+write\s*$/m,
      `${workflowFile} must not request OIDC write permission`
    );
  }

  if (["audit.yml", "ci.yml", "release.yml"].includes(workflowFile)) {
    const toolchainCheck = "node scripts/verify-toolchain.mjs";
    const immutableInstall = "yarn install --immutable";
    const toolchainCheckIndex = workflow.indexOf(toolchainCheck);
    const immutableInstallIndex = workflow.indexOf(immutableInstall);

    assert.match(
      workflow,
      /node scripts\/verify-toolchain\.mjs/,
      `${workflowFile} must enforce the pinned Node/Yarn contract`
    );
    assert.ok(
      immutableInstallIndex >= 0,
      `${workflowFile} must install dependencies immutably`
    );
    assert.ok(
      toolchainCheckIndex < immutableInstallIndex,
      `${workflowFile} must verify the toolchain before installing dependencies`
    );
  }
}

process.stdout.write(
  `Workflow policy OK: ${workflowFiles.length} files, immutable action references and least-privilege checks\n`
);
