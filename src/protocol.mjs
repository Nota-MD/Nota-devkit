import { randomUUID } from "node:crypto";

export const protocolVersion = 1;

export class BridgeError extends Error {
  constructor(message, code = "bridge_error") {
    super(message);
    this.name = "BridgeError";
    this.code = code;
  }
}

const tokenCache = new WeakMap();

function endpoint(config, path) {
  return `http://${config.nota.host}:${config.nota.port}${path}`;
}

function headers(config) {
  const value = { "content-type": "application/json" };
  const token = config.nota.token || tokenCache.get(config);
  if (token) {
    value.authorization = `Bearer ${token}`;
  }
  return value;
}

export async function authenticate(config) {
  if (config.nota.token) return config.nota.token;
  const cached = tokenCache.get(config);
  if (cached) return cached;
  if (!config.nota.password) {
    throw new BridgeError(
      "Developer bridge authentication requires --password or --token",
      "password_required",
    );
  }
  let response;
  try {
    response = await fetch(endpoint(config, "/v1/auth"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: config.nota.password }),
      signal: AbortSignal.timeout(config.nota.timeoutMs),
    });
  } catch (error) {
    throw new BridgeError(`Authentication failed: ${error.message}`, "unreachable");
  }
  const body = await response.json().catch(() => null);
  if (!response.ok || body?.ok !== true || !body.token) {
    throw new BridgeError(
      body?.error?.message ?? `Authentication returned HTTP ${response.status}`,
      body?.error?.code ?? "authentication_failed",
    );
  }
  tokenCache.set(config, body.token);
  return body.token;
}

export async function probe(config) {
  let response;
  try {
    response = await fetch(endpoint(config, "/v1/health"), {
      headers: headers(config),
      signal: AbortSignal.timeout(config.nota.timeoutMs),
    });
  } catch (error) {
    throw new BridgeError(
      `Nota Dev is not reachable at ${config.nota.host}:${config.nota.port}: ${error.message}`,
      "unreachable",
    );
  }
  const body = await response.json().catch(() => null);
  if (!response.ok || body?.ok !== true) {
    throw new BridgeError(
      body?.error?.message ?? `Health check returned HTTP ${response.status}`,
      body?.error?.code ?? "health_failed",
    );
  }
  if (body.protocol !== protocolVersion) {
    throw new BridgeError(
      `Protocol mismatch: expected ${protocolVersion}, received ${body.protocol}`,
      "protocol_mismatch",
    );
  }
  return body;
}

export function refreshPayload(kind, root, paths) {
  return {
    protocol: protocolVersion,
    requestId: randomUUID(),
    kind,
    root,
    paths: [...new Set(paths)].sort(),
    changedAt: new Date().toISOString(),
  };
}

export async function sendRefresh(config, payload) {
  const method = payload.kind === "plugin" ? "plugin.reload" : "theme.reload";
  const result = await call(config, method, { path: payload.root });
  return {
    ok: true,
    requestId: payload.requestId,
    reloaded: payload.kind,
    result,
  };
}

export async function call(config, method, params = {}, retry = true) {
  await authenticate(config);
  let response;
  try {
    response = await fetch(endpoint(config, "/v1/rpc"), {
      method: "POST",
      headers: headers(config),
      body: JSON.stringify({ method, params }),
      signal: AbortSignal.timeout(config.nota.timeoutMs),
    });
  } catch (error) {
    throw new BridgeError(
      `Refresh request failed: ${error.message}`,
      "unreachable",
    );
  }
  const body = await response.json().catch(() => null);
  if (response.status === 401 && retry) {
    tokenCache.delete(config);
    return call(config, method, params, false);
  }
  if (!response.ok) {
    throw new BridgeError(
      body?.error?.message ?? `Refresh returned HTTP ${response.status}`,
      body?.error?.code ?? "refresh_failed",
    );
  }
  if (body?.ok !== true) {
    throw new BridgeError(
      body?.error?.message ?? "Nota Dev rejected the refresh",
      body?.error?.code ?? "refresh_failed",
    );
  }
  return body.result;
}
