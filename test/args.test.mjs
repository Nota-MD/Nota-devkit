import test from "node:test";
import assert from "node:assert/strict";

import { parseArgs } from "../src/args.mjs";

test("parse command, flags, and paths", () => {
  assert.deepEqual(
    parseArgs(["watch", "./theme", "--port=17322", "--json"]),
    {
      command: "watch",
      flags: { port: "17322", json: true },
      positionals: ["./theme"],
    },
  );
});

test("value flags accept a following token", () => {
  assert.deepEqual(parseArgs(["doctor", "--token", "local"]), {
    command: "doctor",
    flags: { token: "local" },
    positionals: [],
  });
});

test("unknown flags fail", () => {
  assert.throws(() => parseArgs(["watch", "--wat"]), /Unknown option/);
});
