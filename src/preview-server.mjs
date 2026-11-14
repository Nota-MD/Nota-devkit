import { createReadStream, watch } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { basename, extname, normalize, resolve, sep } from "node:path";

const mimeTypes = new Map([
  [".avif", "image/avif"],
  [".css", "text/css; charset=utf-8"],
  [".gif", "image/gif"],
  [".html", "text/html; charset=utf-8"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".map", "application/json; charset=utf-8"],
  [".mp4", "video/mp4"],
  [".otf", "font/otf"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".ttf", "font/ttf"],
  [".wasm", "application/wasm"],
  [".webm", "video/webm"],
  [".webp", "image/webp"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
]);

const liveReload = `
<script>
(() => {
  const events = new EventSource("/__nota_devkit/events");
  events.onmessage = (event) => {
    if (event.data === "reload") location.reload();
  };
})();
</script>
`;

function escapeTitle(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export function injectPreviewHelpers(html, themeCss = "", live = true, title = "") {
  const theme = themeCss
    ? `<style data-nota-devkit-theme>${themeCss.replaceAll("</style", "<\\/style")}</style>`
    : "";
  const additions = `${theme}${live ? liveReload : ""}`;
  const titled =
    title && /<title>[\s\S]*?<\/title>/i.test(html)
      ? html.replace(/<title>[\s\S]*?<\/title>/i, `<title>${escapeTitle(title)}</title>`)
      : title
        ? html.replace(/<head>/i, `<head><title>${escapeTitle(title)}</title>`)
        : html;
  return /<\/head>/i.test(titled)
    ? titled.replace(/<\/head>/i, `${additions}</head>`)
    : `${additions}${titled}`;
}

function safeFile(root, pathname) {
  try {
    const relative = decodeURIComponent(pathname).replace(/^\/+/, "");
    if (relative.includes("\0")) return null;
    const candidate = resolve(root, normalize(relative || "index.html"));
    if (candidate !== root && !candidate.startsWith(`${root}${sep}`)) return null;
    return candidate;
  } catch {
    return null;
  }
}

export async function startPreviewServer(options) {
  const htmlPath = resolve(options.htmlPath);
  const title = options.title || basename(htmlPath);
  const root = options.root ? resolve(options.root) : resolve(htmlPath, "..");
  const themePath = options.themePath ? resolve(options.themePath) : null;
  const clients = new Set();
  let timer = null;
  let closed = false;

  const notify = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      for (const response of clients) response.write("data: reload\n\n");
    }, 80);
  };

  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (url.pathname === "/__nota_devkit/events") {
      response.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });
      response.write(": connected\n\n");
      clients.add(response);
      request.on("close", () => clients.delete(response));
      return;
    }

    const requested =
      url.pathname === "/" || url.pathname === "/index.html"
        ? htmlPath
        : safeFile(root, url.pathname);
    if (!requested) {
      response.writeHead(403);
      response.end("Forbidden");
      return;
    }
    try {
      const info = await stat(requested);
      if (!info.isFile()) throw new Error("not a file");
      if (requested === htmlPath) {
        let source;
        try {
          source = options.render
            ? await options.render()
            : await readFile(requested, "utf8");
        } catch (error) {
          response.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
          response.end(`Nota preview failed:\n${error.message ?? error}`);
          return;
        }
        const themeCss =
          options.injectTheme === false || !themePath
            ? ""
            : await readFile(themePath, "utf8");
        response.writeHead(200, {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
        });
        response.end(
          injectPreviewHelpers(
            source,
            themeCss,
            url.searchParams.get("snapshot") !== "1",
            title,
          ),
        );
        return;
      }
      response.writeHead(200, {
        "content-type": mimeTypes.get(extname(requested).toLowerCase()) ?? "application/octet-stream",
        "cache-control": "no-store",
      });
      createReadStream(requested).pipe(response);
    } catch {
      response.writeHead(404);
      response.end("Not found");
    }
  });

  await new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(options.port, "127.0.0.1", resolveListen);
  });

  const watchers = [
    watch(htmlPath, { persistent: true }, notify),
  ];
  if (themePath) watchers.push(watch(themePath, { persistent: true }, notify));
  for (const watcher of watchers) {
    watcher.on("error", () => notify());
  }

  const address = server.address();
  const url = `http://127.0.0.1:${address.port}/`;
  return {
    url,
    close: async () => {
      if (closed) return;
      closed = true;
      if (timer) clearTimeout(timer);
      for (const watcher of watchers) watcher.close();
      for (const response of clients) response.end();
      await new Promise((resolveClose) => server.close(resolveClose));
    },
  };
}
