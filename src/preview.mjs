import { spawn, spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { platform } from "node:os";
import { basename } from "node:path";
import { startPreviewServer } from "./preview-server.mjs";
import { call } from "./protocol.mjs";

function browserCandidates() {
  if (process.env.NOTA_PREVIEW_BROWSER) {
    return [process.env.NOTA_PREVIEW_BROWSER];
  }
  switch (platform()) {
    case "win32":
      return [
        "msedge",
        "chrome",
        "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
        "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
        "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
        "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
      ];
    case "darwin":
      return ["Google Chrome", "Microsoft Edge", "Chromium"];
    default:
      return ["google-chrome", "google-chrome-stable", "chromium", "microsoft-edge"];
  }
}

function available(browser) {
  if (platform() === "darwin") {
    return spawnSync("open", ["-Ra", browser], { stdio: "ignore" }).status === 0;
  }
  return spawnSync(browser, ["--version"], { stdio: "ignore" }).status === 0;
}

function launch(browser, url, width, height) {
  const args = [
    `--app=${url}`,
    `--window-size=${width},${height}`,
    "--disable-features=Translate",
  ];
  if (platform() === "darwin") {
    return spawn("open", ["-na", browser, "--args", ...args], {
      detached: true,
      stdio: "ignore",
    });
  }
  return spawn(browser, args, { detached: true, stdio: "ignore" });
}

export function previewWindowTitle(htmlPath, themePath, override) {
  return override || `${basename(themePath || htmlPath)} — Nota Preview`;
}

export function isMarkdownPreview(filePath) {
  return /\.(?:md|markdown|mdx|mdown|mkd)$/i.test(filePath);
}

async function renderMarkdown(config, markdownPath, themePath) {
  const markdown = await readFile(markdownPath, "utf8");
  const themeCss = themePath ? await readFile(themePath, "utf8") : undefined;
  const html = await call(config, "preview.render", {
    markdown,
    title: basename(markdownPath),
    ...(themeCss === undefined ? {} : { themeCss }),
  });
  if (typeof html !== "string") {
    throw new Error("Nota returned an invalid preview document");
  }
  return html;
}

export async function runPreview(config, htmlPath, themePath, logger) {
  const markdown = isMarkdownPreview(htmlPath);
  const render = markdown
    ? () => renderMarkdown(config, htmlPath, themePath)
    : null;
  if (render) {
    logger.info("Rendering Markdown through the running Nota instance…");
    await render();
  }
  const server = await startPreviewServer({
    htmlPath,
    themePath,
    port: config.preview.port,
    title: previewWindowTitle(htmlPath, themePath, config.preview.title),
    render,
    injectTheme: markdown ? false : true,
  });
  logger.success(`Preview: ${server.url}`);
  if (config.preview.open) {
    let launched = false;
    for (const browser of browserCandidates()) {
      if (!available(browser)) continue;
      try {
        const child = launch(
          browser,
          server.url,
          config.preview.windowWidth,
          config.preview.windowHeight,
        );
        child.unref();
        launched = true;
        break;
      } catch {
        // Try the next app-mode browser.
      }
    }
    if (!launched) logger.warn("No app-mode browser found. Open the URL manually.");
  }
  await new Promise((resolveStop) => {
    const stop = () => {
      process.off("SIGINT", stop);
      process.off("SIGTERM", stop);
      void server.close().then(resolveStop);
    };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
  });
}
