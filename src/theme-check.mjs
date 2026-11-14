import { readFile, stat } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import { walkFiles } from "./files.mjs";
import { issue } from "./issues.mjs";

const dangerousProtocol = /^(?:javascript|vbscript):/i;

function balancedBraces(source) {
  let depth = 0;
  let quote = "";
  let comment = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1] ?? "";
    if (comment) {
      if (character === "*" && next === "/") {
        comment = false;
        index += 1;
      }
      continue;
    }
    if (!quote && character === "/" && next === "*") {
      comment = true;
      index += 1;
      continue;
    }
    if (quote) {
      if (character === "\\") {
        index += 1;
      } else if (character === quote) {
        quote = "";
      }
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
    } else if (character === "{") {
      depth += 1;
    } else if (character === "}") {
      depth -= 1;
      if (depth < 0) return false;
    }
  }
  return depth === 0 && quote === "";
}

function referenceTargets(source) {
  const targets = [];
  const urlPattern = /url\(\s*(?:"([^"]+)"|'([^']+)'|([^)]*?))\s*\)/gi;
  for (const match of source.matchAll(urlPattern)) {
    targets.push((match[1] ?? match[2] ?? match[3] ?? "").trim());
  }
  const importPattern =
    /@import\s+(?:url\(\s*)?(?:"([^"]+)"|'([^']+)')/gi;
  for (const match of source.matchAll(importPattern)) {
    targets.push((match[1] ?? match[2] ?? "").trim());
  }
  return targets.filter(Boolean);
}

function localReference(value) {
  if (
    !value ||
    value.startsWith("#") ||
    value.startsWith("data:") ||
    value.startsWith("blob:") ||
    /^https?:/i.test(value)
  ) {
    return null;
  }
  return value.split(/[?#]/, 1)[0];
}

async function validateCss(file) {
  const issues = [];
  const source = await readFile(file, "utf8");
  if (!balancedBraces(source)) {
    issues.push(issue("error", file, "CSS braces or strings are unbalanced."));
  }
  for (const target of referenceTargets(source)) {
    if (dangerousProtocol.test(target)) {
      issues.push(issue("error", file, `Dangerous URL protocol: ${target}`));
      continue;
    }
    const local = localReference(target);
    if (!local) continue;
    let decoded = local;
    try {
      decoded = decodeURIComponent(local);
    } catch {
      issues.push(issue("warning", file, `Invalid URL encoding: ${target}`));
    }
    const resolved = resolve(dirname(file), decoded);
    try {
      if (!(await stat(resolved)).isFile()) throw new Error("not a file");
    } catch {
      issues.push(issue("error", file, `Referenced asset does not exist: ${target}`));
    }
  }
  if (!/\.css$/i.test(file) && extname(file) !== "") {
    issues.push(issue("warning", file, "Theme entry should be a CSS file."));
  }
  return issues;
}

export async function validateTheme(target) {
  const info = await stat(target);
  const cssFiles = info.isDirectory()
    ? await walkFiles(target, (file) => extname(file).toLowerCase() === ".css")
    : [target];
  if (cssFiles.length === 0) {
    return [issue("error", target, "Theme contains no CSS files.")];
  }
  const issues = [];
  for (const file of cssFiles) issues.push(...(await validateCss(file)));
  return issues;
}
