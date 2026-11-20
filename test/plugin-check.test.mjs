import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { validatePlugin } from "../src/plugin-check.mjs";

async function pluginRoot(manifest, files = {}) {
  const root = await mkdtemp(join(tmpdir(), "nota-devkit-plugin-"));
  await writeFile(join(root, "plugin.toml"), manifest);
  for (const [path, source] of Object.entries(files)) {
    await writeFile(join(root, path), source);
  }
  return root;
}

test("valid local plugin has no issues", async () => {
  const root = await pluginRoot(
    `[plugin]
id = "example.hello"
name = "Hello"
api = "v2.3"
entry = "main.lua"
capabilities = ["ui.notify"]
langs = ["en", "zh-CN"]
`,
    {
      "main.lua": 'local message = require("message")\n',
      "message.lua": 'return { hello = "hello" }\n',
    },
  );
  assert.deepEqual(await validatePlugin(root), []);
});

test("unknown capability and missing entry are errors", async () => {
  const root = await pluginRoot(`[plugin]
id = "example.bad"
name = "Bad"
api = "v2.3"
entry = "main.lua"
capabilities = ["fs.everything"]
`);
  const issues = await validatePlugin(root);
  assert.equal(issues.some((item) => item.message.includes("Unknown capability")), true);
  assert.equal(issues.some((item) => item.message.includes("Entry file")), true);
});

test("API compatibility accepts older minors and rejects newer or foreign majors", async () => {
  const compatible = await pluginRoot(`[plugin]
id = "example.compatible"
name = "Compatible"
api = "v2.2"
entry = "main.lua"
`, { "main.lua": "return {}\n" });
  assert.deepEqual(await validatePlugin(compatible), []);

  for (const api of ["v2.4", "v3.0"]) {
    const incompatible = await pluginRoot(`[plugin]
id = "example.incompatible"
name = "Incompatible"
api = "${api}"
entry = "main.lua"
`, { "main.lua": "return {}\n" });
    const issues = await validatePlugin(incompatible);
    assert.equal(
      issues.some((item) => item.message.includes("incompatible with host API")),
      true,
      `${api} was accepted`,
    );
  }
});

test("settings and devserver declarations require capabilities", async () => {
  const root = await pluginRoot(`[plugin]
id = "example.declarations"
name = "Declarations"
api = "v2.3"
entry = "main.lua"
capabilities = []

[devserver]
cmd = "example"
args = []

[[settings]]
key = "speed"
kind = "range"
label = "Speed"
min = 1
max = 10
default = 5
`, { "main.lua": "return {}\n" });
  const issues = await validatePlugin(root);
  assert.equal(issues.some((item) => item.message.includes("settings.own")), true);
  assert.equal(issues.some((item) => item.message.includes("process.devserver")), true);
});
