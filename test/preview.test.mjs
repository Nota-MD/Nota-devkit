import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  injectPreviewHelpers,
  startPreviewServer,
} from "../src/preview-server.mjs";
import {
  isMarkdownPreview,
  previewWindowTitle,
} from "../src/preview.mjs";

test("live preview injects theme CSS and reload support", () => {
  const output = injectPreviewHelpers(
    "<html><head></head><body>preview</body></html>",
    "body { color: red; }",
    true,
  );
  assert.match(output, /data-nota-devkit-theme/);
  assert.match(output, /EventSource/);
});

test("snapshot preview injects theme CSS without keeping the browser alive", () => {
  const output = injectPreviewHelpers(
    "<html><head></head><body>preview</body></html>",
    "body { color: red; }",
    false,
  );
  assert.match(output, /data-nota-devkit-theme/);
  assert.doesNotMatch(output, /EventSource/);
});

test("theme closing tags cannot terminate the injected style element", () => {
  const output = injectPreviewHelpers(
    "<html><head></head><body></body></html>",
    "body::after { content: \"</style>\"; }",
    false,
  );
  assert.doesNotMatch(output, /body::after \{ content: "<\/style>"; \}/);
  assert.match(output, /<\\\/style>/);
});

test("preview title identifies the open file", () => {
  const output = injectPreviewHelpers(
    "<html><head><title>Old</title></head><body></body></html>",
    "",
    false,
    "note.md",
  );
  assert.match(output, /<title>note\.md<\/title>/);
  assert.doesNotMatch(output, /<title>Old<\/title>/);
});

test("preview window title prefers the open CSS file", () => {
  assert.equal(
    previewWindowTitle("/tmp/preview.html", "/tmp/my-theme.css", null),
    "my-theme.css — Nota Preview",
  );
  assert.equal(
    previewWindowTitle("/tmp/preview.html", null, null),
    "preview.html — Nota Preview",
  );
});

test("Markdown files use the running Nota renderer", () => {
  assert.equal(isMarkdownPreview("/tmp/note.md"), true);
  assert.equal(isMarkdownPreview("/tmp/note.markdown"), true);
  assert.equal(isMarkdownPreview("/tmp/note.html"), false);
});

test("dynamic preview renders through its supplied renderer", async () => {
  const root = await mkdtemp(join(tmpdir(), "nota-devkit-render-"));
  const markdown = join(root, "note.md");
  await writeFile(markdown, "# source\n");
  let calls = 0;
  const server = await startPreviewServer({
    htmlPath: markdown,
    port: 0,
    title: "theme.css — Nota Preview",
    render: async () => {
      calls += 1;
      return "<html><head><title>old</title></head><body><h1>Rendered</h1></body></html>";
    },
    injectTheme: false,
  });
  try {
    const response = await fetch(`${server.url}?snapshot=1`);
    const html = await response.text();
    assert.equal(response.status, 200);
    assert.match(html, /<h1>Rendered<\/h1>/);
    assert.match(html, /<title>theme\.css — Nota Preview<\/title>/);
    assert.equal(calls, 1);
    const blocked = await fetch(`${server.url}%2e%2e/secret.txt?snapshot=1`);
    assert.ok(blocked.status === 403 || blocked.status === 404);
  } finally {
    await server.close();
  }
});
