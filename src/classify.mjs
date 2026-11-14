import { basename, extname } from "node:path";

export const themeAssetExtensions = new Set([
  ".avif",
  ".gif",
  ".jpeg",
  ".jpg",
  ".otf",
  ".png",
  ".svg",
  ".ttf",
  ".webp",
  ".woff",
  ".woff2",
]);

export function classifyFile(filePath) {
  const name = basename(filePath);
  const ext = extname(filePath).toLowerCase();
  if (name === "plugin.toml" || ext === ".lua") return "plugin";
  if (ext === ".css" || name === ".nota-themes.json") return "theme";
  if (themeAssetExtensions.has(ext)) return "asset";
  return null;
}
