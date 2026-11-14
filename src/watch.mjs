import { watch } from "node:fs";
import { stat } from "node:fs/promises";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";
import { classifyFile } from "./classify.mjs";
import { findPluginDirectory } from "./plugin-check.mjs";
import {
  BridgeError,
  authenticate,
  call,
  probe,
  refreshPayload,
  sendRefresh,
} from "./protocol.mjs";

function isIgnored(file, ignore) {
  const parts = resolve(file).split(sep);
  return ignore.some((item) => {
    if (item.includes("*")) {
      const escaped = item
        .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
        .replaceAll("*", ".*");
      return new RegExp(`^${escaped}$`).test(basename(file));
    }
    return parts.includes(item);
  });
}

async function eventRoot(kind, file, watchedRoot) {
  if (kind === "plugin") {
    const found = await findPluginDirectory(file);
    if (found) return found;
  }
  if (kind === "theme" && extname(file).toLowerCase() === ".css") {
    return file;
  }
  if (kind === "theme" || kind === "asset") {
    let directory = dirname(file);
    for (;;) {
      try {
        if ((await stat(join(directory, "theme.css"))).isFile()) return directory;
      } catch {
        // Continue upward.
      }
      const parent = dirname(directory);
      if (parent === directory || !parent.startsWith(resolve(watchedRoot))) break;
      directory = parent;
    }
  }
  return watchedRoot;
}

function closeWatcher(watcher) {
  return new Promise((resolveClose) => watcher.close(resolveClose));
}

export async function runWatch(config, targets, logger) {
  const pending = new Map();
  const watchers = [];
  let stopped = false;
  let retryTimer = null;
  let lastBridgeError = "";

  const flush = async (key) => {
    const item = pending.get(key);
    if (!item || stopped) return;
    item.timer = null;
    const generation = item.generation;
    const payload = refreshPayload(item.kind, item.root, item.paths);
    try {
      const response = await sendRefresh(config, payload);
      if (item.generation === generation) pending.delete(key);
      lastBridgeError = "";
      logger.success(
        `Reloaded ${item.kind} ${response.reloaded ?? ""}`.trim(),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message !== lastBridgeError) {
        logger.warn(`${message}; waiting for Nota Dev.`);
        lastBridgeError = message;
      }
      if (!stopped && !retryTimer) {
        retryTimer = setTimeout(() => {
          retryTimer = null;
          for (const pendingKey of pending.keys()) {
            schedule(pendingKey, 0);
          }
        }, 1000);
      }
    }
  };

  const schedule = (key, delay = config.watch.debounceMs) => {
    const item = pending.get(key);
    if (!item) return;
    item.generation += 1;
    if (item.timer) clearTimeout(item.timer);
    item.timer = setTimeout(() => void flush(key), delay);
  };

  const queueEvent = async (file, watchedRoot) => {
    const kind = classifyFile(file);
    if (!kind || isIgnored(file, config.watch.ignore)) return;
    const root = await eventRoot(kind, file, watchedRoot);
    const key = `${kind}:${root}`;
    const item = pending.get(key) ?? {
      kind,
      root,
      paths: new Set(),
      generation: 0,
      timer: null,
    };
    item.paths.add(resolve(file));
    pending.set(key, item);
    logger.event(`${kind}: ${relative(root, file) || basename(file)}`);
    schedule(key);
  };

  for (const target of targets) {
    const info = await stat(target);
    const watchedRoot = info.isDirectory() ? target : dirname(target);
    const handler = (eventType, filename) => {
      if (!filename) return;
      const file = info.isDirectory()
        ? join(watchedRoot, filename.toString())
        : target;
      void queueEvent(file, watchedRoot);
    };
    try {
      const watcher = watch(watchedRoot, {
        recursive: info.isDirectory(),
        persistent: true,
      }, handler);
      watcher.on("error", (error) => logger.error(`Watch error: ${error.message}`));
      watchers.push(watcher);
    } catch (error) {
      throw new Error(`Cannot watch ${target}: ${error.message}`);
    }
    logger.info(
      `Watching ${relative(process.cwd(), target) || "."}${info.isDirectory() ? "/**" : ""}`,
    );
  }

  try {
    const health = await probe(config);
    logger.success(
      `Connected to ${health.app ?? "Nota Dev"} ${health.version ?? ""}`.trim(),
    );
  } catch (error) {
    logger.warn(error instanceof Error ? error.message : String(error));
  }

  await new Promise((resolveStop) => {
    const stop = () => {
      if (stopped) return;
      stopped = true;
      if (retryTimer) clearTimeout(retryTimer);
      for (const item of pending.values()) {
        if (item.timer) clearTimeout(item.timer);
      }
      void Promise.all(watchers.map(closeWatcher)).then(resolveStop);
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
  logger.info("Stopped.");
}

export async function doctor(config, logger, options = {}) {
  try {
    const health = await probe(config);
    await authenticate(config);
    health.authenticated = true;
    health.appInfo = await call(config, "app.info");
    if (!options.quiet) {
      logger.success("Nota Dev bridge is available.");
      logger.info(JSON.stringify(health, null, 2));
    }
    return health;
  } catch (error) {
    if (error instanceof BridgeError) {
      logger.error(`${error.code}: ${error.message}`);
    } else {
      logger.error(error instanceof Error ? error.message : String(error));
    }
    throw error;
  }
}
