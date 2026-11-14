import { stat } from "node:fs/promises";
import { basename, dirname, extname } from "node:path";
import { walkFiles } from "./files.mjs";
import { validatePlugin } from "./plugin-check.mjs";
import { validateTheme } from "./theme-check.mjs";
import { hasErrors, issue } from "./issues.mjs";

export async function validateTarget(target, options = {}) {
  const info = await stat(target);
  if (info.isFile()) {
    if (target.endsWith("plugin.toml")) {
      return validatePlugin(target, options);
    }
    if (extname(target).toLowerCase() === ".css") {
      return validateTheme(target);
    }
    if (extname(target).toLowerCase() === ".lua") {
      return validatePlugin(target, options);
    }
    return [issue("warning", target, "Unsupported file type; nothing was checked.")];
  }

  const discovered = await walkFiles(
    target,
    (file) =>
      extname(file).toLowerCase() === ".css" ||
      basename(file) === "plugin.toml",
  );
  const pluginRoots = new Set(
    discovered
      .filter((file) => basename(file) === "plugin.toml")
      .map((file) => dirname(file)),
  );
  const cssFiles = discovered.filter(
    (file) => extname(file).toLowerCase() === ".css",
  );
  const issues = [];
  const recognized = pluginRoots.size > 0 || cssFiles.length > 0;
  for (const root of pluginRoots) {
    issues.push(...(await validatePlugin(root, options)));
  }
  for (const file of cssFiles) {
    issues.push(...(await validateTheme(file)));
  }
  if (!recognized) {
    issues.push(issue("warning", target, "No plugin or theme files were found."));
  }
  return issues;
}

export async function checkTargets(targets, options = {}) {
  const issues = [];
  for (const target of targets) {
    try {
      issues.push(...(await validateTarget(target, options)));
    } catch (error) {
      issues.push(issue("error", target, error.message));
    }
  }
  return { issues, failed: hasErrors(issues) };
}
