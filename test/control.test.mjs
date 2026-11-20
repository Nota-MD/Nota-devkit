import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  formatDocuments,
  formatStatus,
  getEditorStatus,
  checkExtensionUpdates,
  installExtension,
  listExtensions,
  openDocument,
  parseDocumentId,
  readDocument,
  setExtensionEnabled,
  uninstallExtension,
  updateAllExtensions,
  updateExtension,
  writeDocument,
} from "../src/control.mjs";

const status = {
  app: "Nota",
  version: "0.14.0-beta",
  apiVersion: "v2.3",
  active: {
    id: 7,
    title: "Remote note",
    path: "/tmp/remote.md",
    dirty: true,
    revision: 3,
    active: true,
  },
  documents: [
    {
      id: 7,
      title: "Remote note",
      path: "/tmp/remote.md",
      dirty: true,
      revision: 3,
      active: true,
    },
    {
      id: 8,
      title: "Scratch",
      path: null,
      dirty: false,
      revision: 0,
      active: false,
    },
  ],
};

function mockBridge() {
  const requests = [];
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      const payload = JSON.parse(body);
      requests.push(payload);
      const results = {
        "editor.status": status,
        "documents.read": {
          id: 7,
          title: "Remote note",
          path: "/tmp/remote.md",
          dirty: true,
          revision: 3,
          text: "# Remote\n",
        },
        "documents.write": { id: 7, revision: 4, chars: 9 },
        "documents.open": { requested: "/tmp/opened.md" },
        "plugins.list": [{ id: "demo", enabled: true }],
        "plugins.install": { id: "demo" },
        "plugins.uninstall": { id: "demo", uninstalled: true },
        "plugins.setEnabled": { id: "demo", enabled: true },
        "plugins.checkUpdates": [{ id: "demo", available: true }],
        "plugins.update": { id: "demo", updated: true },
        "plugins.updateAll": { results: [] },
      };
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ ok: true, result: results[payload.method] }));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve({ server, requests }));
  });
}

test("document ids accept active aliases and reject invalid values", () => {
  assert.equal(parseDocumentId(), null);
  assert.equal(parseDocumentId("active"), null);
  assert.equal(parseDocumentId("12"), 12);
  assert.throws(() => parseDocumentId("0"), /positive integer/);
  assert.throws(() => parseDocumentId("1.5"), /positive integer/);
});

test("extension management uploads local packages and controls updates", async () => {
  const { server, requests } = await mockBridge();
  const dir = await mkdtemp(join(tmpdir(), "nota-devkit-extension."));
  const file = join(dir, "demo.nota-plugin");
  await writeFile(file, "package-bytes");
  const config = {
    nota: {
      host: "127.0.0.1",
      port: server.address().port,
      token: "test-token",
      password: "",
      timeoutMs: 1000,
    },
  };
  try {
    assert.deepEqual(await listExtensions(config), [{ id: "demo", enabled: true }]);
    await installExtension(config, file);
    await installExtension(config, "/host/demo.nota-plugin", { hostPath: true });
    await uninstallExtension(config, "demo");
    await setExtensionEnabled(config, "demo", true);
    await checkExtensionUpdates(config);
    await updateExtension(config, "demo");
    await updateAllExtensions(config);
    assert.equal(requests[1].method, "plugins.install");
    assert.equal(
      Buffer.from(requests[1].params.base64, "base64").toString(),
      "package-bytes",
    );
    assert.equal(requests[1].params.filename, "demo.nota-plugin");
    assert.deepEqual(requests[2].params, { path: "/host/demo.nota-plugin" });
    assert.deepEqual(requests[6].params, { id: "demo" });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("status and documents formatting keep active and dirty visible", () => {
  const text = formatStatus(status);
  assert.match(text, /Active: \[7\] Remote note \(modified\)/);
  assert.match(text, /Documents \(2\):/);
  assert.match(formatDocuments(status.documents), /\* \[7\].*\[active, modified\]/);
  assert.match(formatDocuments(status.documents), /\[8\] Scratch/);
  assert.match(formatDocuments([]), /No documents/);
});

test("remote control calls status, read, write and open", async () => {
  const { server, requests } = await mockBridge();
  const config = {
    nota: {
      host: "127.0.0.1",
      port: server.address().port,
      token: "test-token",
      password: "",
      timeoutMs: 1000,
    },
  };
  try {
    assert.equal((await getEditorStatus(config)).active.id, 7);
    assert.equal((await readDocument(config)).text, "# Remote\n");
    assert.equal((await writeDocument(config, 7, "new text")).revision, 4);
    await openDocument(config, "/tmp/opened.md");
    assert.deepEqual(
      requests.map((request) => request.method),
      ["editor.status", "documents.read", "documents.write", "documents.open"],
    );
    assert.deepEqual(requests[1].params, {});
    assert.deepEqual(requests[2].params, { id: 7, text: "new text" });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
