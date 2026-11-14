import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { validateTheme } from "../src/theme-check.mjs";

test("valid theme has no errors", async () => {
  const root = await mkdtemp(join(tmpdir(), "nota-devkit-theme-"));
  const css = join(root, "theme.css");
  await writeFile(css, ":root { --fg: #222; } body { color: var(--fg); }");
  assert.deepEqual(await validateTheme(css), []);
});

test("missing local assets and bad braces are errors", async () => {
  const root = await mkdtemp(join(tmpdir(), "nota-devkit-theme-"));
  const css = join(root, "theme.css");
  await writeFile(css, "body { background: url('./missing.png');");
  const issues = await validateTheme(css);
  assert.equal(issues.some((item) => item.message.includes("unbalanced")), true);
  assert.equal(issues.some((item) => item.message.includes("does not exist")), true);
});

test("dangerous URL protocols are rejected", async () => {
  const root = await mkdtemp(join(tmpdir(), "nota-devkit-theme-"));
  const css = join(root, "theme.css");
  await writeFile(css, "body { background: url('javascript:alert(1)'); }");
  const issues = await validateTheme(css);
  assert.equal(issues.some((item) => item.message.includes("Dangerous")), true);
});
