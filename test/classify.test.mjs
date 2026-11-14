import test from "node:test";
import assert from "node:assert/strict";

import { classifyFile } from "../src/classify.mjs";

test("classify reloadable files", () => {
  assert.equal(classifyFile("theme.css"), "theme");
  assert.equal(classifyFile("fonts/body.woff2"), "asset");
  assert.equal(classifyFile("plugin/main.lua"), "plugin");
  assert.equal(classifyFile("plugin/plugin.toml"), "plugin");
  assert.equal(classifyFile("README.md"), null);
});
