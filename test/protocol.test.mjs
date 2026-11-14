import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";

import {
  probe,
  refreshPayload,
  sendRefresh,
} from "../src/protocol.mjs";

function mockBridge() {
  const server = createServer((request, response) => {
    response.setHeader("content-type", "application/json");
    if (request.url === "/v1/health") {
      response.end(JSON.stringify({
        ok: true,
        protocol: 1,
        app: "nota-dev",
        version: "test",
        features: ["theme.reload", "plugin.reload"],
      }));
      return;
    }
    if (request.url === "/v1/auth") {
      response.end(JSON.stringify({ ok: true, token: "session-token" }));
      return;
    }
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      const payload = JSON.parse(body);
      response.end(JSON.stringify({
        ok: true,
        result: { queued: true, method: payload.method },
      }));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

test("health and refresh use the v1 loopback protocol", async () => {
  const server = await mockBridge();
  const address = server.address();
  const config = {
    nota: {
      host: "127.0.0.1",
      port: address.port,
      token: "local",
      password: "",
      timeoutMs: 1000,
    },
  };
  try {
    assert.equal((await probe(config)).protocol, 1);
    const payload = refreshPayload("theme", "/tmp/theme", ["/tmp/theme/a.css"]);
    const result = await sendRefresh(config, payload);
    assert.equal(result.reloaded, "theme");
    assert.equal(result.requestId, payload.requestId);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
