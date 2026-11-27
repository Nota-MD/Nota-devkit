import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  readInputScript,
  validateInputScript,
} from "../src/input.mjs";

test("input scripts accept action arrays and wrapped actions", () => {
  const actions = [{ type: "focus" }, { type: "text", text: "# Nota" }];
  assert.equal(validateInputScript(actions), actions);
  assert.deepEqual(validateInputScript({ actions }), { actions });
});

test("input scripts reject empty and malformed action lists", () => {
  assert.throws(() => validateInputScript([]), /between 1/);
  assert.throws(() => validateInputScript({ actions: [null] }), /object/);
  assert.throws(() => validateInputScript({ actions: [{}] }), /requires a type/);
});

test("input scripts load relative to the requested base directory", async () => {
  const directory = await mkdtemp(join(tmpdir(), "nota-devkit-input."));
  await writeFile(
    join(directory, "demo.json"),
    JSON.stringify({ actions: [{ type: "key", key: "Enter" }] }),
  );
  assert.deepEqual(await readInputScript("demo.json", directory), {
    actions: [{ type: "key", key: "Enter" }],
  });
});
