import assert from "node:assert/strict";
import test from "node:test";
import { classifyRegistryVersionResult } from "../scripts/registry-version-result.mjs";

test("classifies a successful npm view as an existing version", () => {
  assert.deepEqual(
    classifyRegistryVersionResult({
      status: 0,
      stdout: '"0.1.0"\n',
      stderr: "",
    }),
    { kind: "exists" }
  );
});

test("classifies only npm E404 as an available version", () => {
  assert.deepEqual(
    classifyRegistryVersionResult({
      status: 1,
      stdout: "",
      stderr: "npm error code E404\nnpm error 404 Not Found",
    }),
    { kind: "available" }
  );
});

test("fails closed when npm cannot prove version availability", () => {
  assert.deepEqual(
    classifyRegistryVersionResult({
      status: 1,
      stdout: "",
      stderr: "npm error code EAI_AGAIN",
    }),
    { kind: "registry-error", diagnostic: "npm error code EAI_AGAIN" }
  );
  assert.deepEqual(
    classifyRegistryVersionResult({
      status: null,
      stdout: "",
      stderr: "",
      error: new Error("spawn failed"),
    }),
    { kind: "registry-error", diagnostic: "spawn failed" }
  );
});
