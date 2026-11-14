import { readdir } from "node:fs/promises";
import { join } from "node:path";

export const defaultIgnoredDirectories = new Set([
  ".git",
  ".nota-devkit",
  "dist",
  "node_modules",
  "target",
]);

export async function walkFiles(root, accept, ignored = defaultIgnoredDirectories) {
  const output = [];

  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && ignored.has(entry.name)) continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(path);
      } else if (entry.isFile() && accept(path)) {
        output.push(path);
      }
    }
  }

  await visit(root);
  return output;
}
