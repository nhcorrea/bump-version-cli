import assert from "node:assert/strict";
import test from "node:test";
import { compareVersionParts } from "../scripts/toolchain-version.mjs";

test("compares versions by precedence instead of independent components", () => {
  assert.equal(compareVersionParts([21, 99, 0], [22, 12, 0]), -1);
  assert.equal(compareVersionParts([22, 11, 99], [22, 12, 0]), -1);
  assert.equal(compareVersionParts([22, 12, 0], [22, 12, 0]), 0);
  assert.equal(compareVersionParts([22, 13, 0], [22, 12, 0]), 1);
  assert.equal(compareVersionParts([24, 0, 0], [22, 12, 0]), 1);
});

test("treats omitted trailing components as zero", () => {
  assert.equal(compareVersionParts([22, 12], [22, 12, 0]), 0);
  assert.equal(compareVersionParts([22, 12, 1], [22, 12]), 1);
});
