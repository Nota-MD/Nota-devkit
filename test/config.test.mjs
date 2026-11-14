import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { applyFlagOverrides, loadConfig } from "../src/config.mjs";

test("environment password is available without project credentials", async () => {
  const previous = process.env.NOTA_DEVKIT_PASSWORD;
  process.env.NOTA_DEVKIT_PASSWORD = "environment-secret";
  const cwd = await mkdtemp(join(tmpdir(), "nota-devkit-config-"));
  try {
    const config = await loadConfig({ cwd });
    assert.equal(config.nota.password, "environment-secret");
    assert.equal(config.nota.timeoutMs, 30000);
  } finally {
    if (previous === undefined) delete process.env.NOTA_DEVKIT_PASSWORD;
    else process.env.NOTA_DEVKIT_PASSWORD = previous;
  }
});

test("host override rejects URL and whitespace injection", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "nota-devkit-config-"));
  const config = await loadConfig({ cwd });
  assert.equal(applyFlagOverrides(config, { host: "192.168.1.20" }).nota.host, "192.168.1.20");
  assert.throws(() => applyFlagOverrides(config, { host: "localhost/path" }), /Invalid host/);
  assert.throws(() => applyFlagOverrides(config, { host: "host name" }), /Invalid host/);
});
