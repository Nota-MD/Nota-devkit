import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { call } from "./protocol.mjs";

const MAX_ACTIONS = 10_000;
const MAX_SCRIPT_BYTES = 2 * 1024 * 1024;
const INPUT_TIMEOUT_MS = 16 * 60 * 1000;

function actionList(script) {
  if (Array.isArray(script)) return script;
  if (script && typeof script === "object" && Array.isArray(script.actions)) {
    return script.actions;
  }
  throw new Error("Input script must be an actions array or an object with actions");
}

export function validateInputScript(script) {
  const actions = actionList(script);
  if (actions.length === 0 || actions.length > MAX_ACTIONS) {
    throw new Error(`Input script must contain between 1 and ${MAX_ACTIONS} actions`);
  }
  for (const action of actions) {
    if (!action || typeof action !== "object" || Array.isArray(action)) {
      throw new Error("Every input action must be an object");
    }
    if (typeof action.type !== "string" || !action.type) {
      throw new Error("Every input action requires a type");
    }
  }
  return script;
}

export async function readInputScript(file, base = process.cwd()) {
  const path = resolve(base, file);
  const source = await readFile(path, "utf8");
  if (Buffer.byteLength(source, "utf8") > MAX_SCRIPT_BYTES) {
    throw new Error(`Input script exceeds ${MAX_SCRIPT_BYTES} bytes`);
  }
  let script;
  try {
    script = JSON.parse(source);
  } catch (error) {
    throw new Error(`Cannot parse ${path}: ${error.message}`);
  }
  return validateInputScript(script);
}

export async function playInput(config, script) {
  const validated = validateInputScript(script);
  const params = Array.isArray(validated) ? { actions: validated } : validated;
  const longRunning = {
    ...config,
    nota: {
      ...config.nota,
      timeoutMs: Math.max(config.nota.timeoutMs, INPUT_TIMEOUT_MS),
    },
  };
  return call(longRunning, "input.play", params);
}
