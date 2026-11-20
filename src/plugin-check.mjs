import { readFile, stat } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { walkFiles } from "./files.mjs";
import { issue } from "./issues.mjs";

const knownCapabilities = new Set([
  "document.read",
  "document.write",
  "fs.read",
  "fs.write",
  "process.git",
  "process.devserver",
  "network.http",
  "ui.notify",
  "ui.open_url",
  "ui.panel",
  "ui.menu",
  "editor.input",
  "settings.own",
  "data.own",
]);

function stripComment(value) {
  let quote = "";
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quote) {
      if (character === "\\") index += 1;
      else if (character === quote) quote = "";
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
    } else if (character === "#") {
      return value.slice(0, index).trimEnd();
    }
  }
  return value.trimEnd();
}

function parseValue(source) {
  const value = stripComment(source).trim();
  if (value.startsWith('"') && value.endsWith('"')) {
    return JSON.parse(value);
  }
  if (value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1);
  }
  if (/^-?\d+$/.test(value)) return Number(value);
  if (value === "true") return true;
  if (value === "false") return false;
  if (value.startsWith("[") && value.endsWith("]")) {
    return [...value.matchAll(/"((?:[^"\\]|\\.)*)"|'([^']*)'/g)].map(
      (match) => match[1]?.replaceAll('\\"', '"') ?? match[2] ?? "",
    );
  }
  return value;
}

function pluginSection(source) {
  const values = {};
  let section = "";
  const lines = source.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line || line.startsWith("#")) continue;
    const header = /^\[([^\]]+)\]$/.exec(line);
    if (header) {
      section = header[1];
      continue;
    }
    if (section !== "plugin") continue;
    const assignment = /^([A-Za-z0-9_-]+)\s*=\s*(.+)$/.exec(line);
    if (!assignment) continue;
    let raw = assignment[2];
    if (raw.trimStart().startsWith("[") && !raw.includes("]")) {
      while (index + 1 < lines.length) {
        index += 1;
        raw += `\n${lines[index]}`;
        if (lines[index].includes("]")) break;
      }
    }
    values[assignment[1]] = parseValue(raw);
  }
  return values;
}

function localModules(source) {
  const modules = [];
  const pattern = /\brequire\s*(?:\(\s*)?["']([^"']+)["']/g;
  for (const match of source.matchAll(pattern)) modules.push(match[1]);
  return [...new Set(modules)];
}

export async function validatePlugin(target, options = {}) {
  const info = await stat(target);
  const root =
    info.isDirectory()
      ? target
      : target.endsWith("plugin.toml")
        ? dirname(target)
        : await findPluginDirectory(target);
  if (!root) {
    return [issue("error", target, "Cannot find a parent plugin.toml.")];
  }
  const manifestPath = join(root, "plugin.toml");
  let source;
  try {
    source = await readFile(manifestPath, "utf8");
  } catch {
    return [issue("error", manifestPath, "plugin.toml does not exist.")];
  }
  const values = pluginSection(source);
  const issues = [];
  for (const key of ["id", "name", "api"]) {
    if (values[key] === undefined || values[key] === "") {
      issues.push(issue("error", manifestPath, `Missing required field: ${key}`));
    }
  }
  if (values.id && !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(String(values.id))) {
    issues.push(issue("error", manifestPath, "Plugin id must use ASCII letters, digits, dot, underscore or dash."));
  }
  const expectedApi = String(options.apiVersion ?? "v2.3");
  const hostMatch = /^v(\d+)\.(\d+)$/.exec(expectedApi);
  if (!hostMatch) {
    issues.push(issue("error", manifestPath, `Host API must use vMAJOR.MINOR, received ${expectedApi}.`));
  } else if (values.api !== undefined) {
    const pluginMatch = /^v(\d+)\.(\d+)$/.exec(String(values.api));
    if (!pluginMatch) {
      issues.push(
        issue("error", manifestPath, `Plugin api must use vMAJOR.MINOR, received ${values.api}.`),
      );
    } else if (
      Number(pluginMatch[1]) !== Number(hostMatch[1]) ||
      Number(pluginMatch[2]) > Number(hostMatch[2])
    ) {
      issues.push(
        issue(
          "error",
          manifestPath,
          `Plugin api ${values.api} is incompatible with host API ${expectedApi}.`,
        ),
      );
    }
  }
  const entry = String(values.entry ?? "main.lua");
  const entryPath = resolve(root, entry);
  try {
    if (!(await stat(entryPath)).isFile()) throw new Error("not a file");
  } catch {
    issues.push(issue("error", manifestPath, `Entry file does not exist: ${entry}`));
  }
  const capabilities = Array.isArray(values.capabilities)
    ? values.capabilities.map(String)
    : [];
  for (const capability of capabilities) {
    if (!knownCapabilities.has(capability)) {
      issues.push(issue("error", manifestPath, `Unknown capability: ${capability}`));
    }
  }
  const langs = Array.isArray(values.langs) ? values.langs.map(String) : [];
  if (langs.length > 0 && !langs.includes("en")) {
    issues.push(issue("error", manifestPath, "langs must include en."));
  }
  if (/^\[\[settings\]\]$/m.test(source) && !capabilities.includes("settings.own")) {
    issues.push(issue("error", manifestPath, "[[settings]] requires settings.own."));
  }
  if (/^\[devserver\]$/m.test(source) && !capabilities.includes("process.devserver")) {
    issues.push(
      issue("error", manifestPath, "[devserver] requires process.devserver."),
    );
  }
  const luaFiles = await walkFiles(
    root,
    (file) => extname(file).toLowerCase() === ".lua",
  );
  for (const file of luaFiles) {
    const lua = await readFile(file, "utf8");
    for (const moduleName of localModules(lua)) {
      if (moduleName.startsWith(".") || moduleName.includes("..")) {
        issues.push(issue("error", file, `Invalid local module: ${moduleName}`));
        continue;
      }
      const relative = moduleName.replaceAll(".", "/");
      const candidates = [
        resolve(root, `${relative}.lua`),
        resolve(root, relative, "init.lua"),
      ];
      let found = false;
      for (const candidate of candidates) {
        try {
          if ((await stat(candidate)).isFile()) {
            found = true;
            break;
          }
        } catch {
          // Try the next shape.
        }
      }
      if (!found) {
        issues.push(issue("error", file, `Required module does not exist: ${moduleName}`));
      }
    }
  }
  return issues;
}

export async function findPluginDirectory(file) {
  let directory = dirname(file);
  for (;;) {
    try {
      if ((await stat(join(directory, "plugin.toml"))).isFile()) return directory;
    } catch {
      // Continue upward.
    }
    const parent = dirname(directory);
    if (parent === directory) return null;
    directory = parent;
  }
}
