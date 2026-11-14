import { readFile, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const configName = ".nota-devkit.json";

export const defaultConfig = {
  nota: {
    host: "127.0.0.1",
    port: 17321,
    token: "",
    password: "",
    timeoutMs: 30000,
  },
  watch: {
    debounceMs: 120,
    paths: [],
    ignore: [".git", "node_modules", "dist", "target", ".nota-devkit"],
  },
  preview: {
    port: 17322,
    windowWidth: 1100,
    windowHeight: 920,
    open: true,
    entry: null,
    theme: null,
    title: null,
  },
  plugin: {
    apiVersion: 2,
  },
};

export async function findConfig(startDirectory) {
  let directory = resolve(startDirectory);
  for (;;) {
    const candidate = resolve(directory, configName);
    try {
      if ((await stat(candidate)).isFile()) return candidate;
    } catch {
      // Keep walking upward.
    }
    const parent = dirname(directory);
    if (parent === directory) return null;
    directory = parent;
  }
}

export async function loadConfig(options = {}) {
  const cwd = resolve(options.cwd ?? process.cwd());
  const file = options.file
    ? resolve(cwd, options.file)
    : await findConfig(cwd);
  if (!file) {
    const fallback = structuredClone(defaultConfig);
    if (process.env.NOTA_DEVKIT_PASSWORD) {
      fallback.nota.password = process.env.NOTA_DEVKIT_PASSWORD;
    }
    return { ...fallback, file: null, directory: cwd };
  }
  let parsed;
  try {
    parsed = JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    throw new Error(`Cannot read ${file}: ${error.message}`);
  }
  return {
    nota: {
      ...defaultConfig.nota,
      ...parsed.nota,
      ...(process.env.NOTA_DEVKIT_PASSWORD
        ? { password: process.env.NOTA_DEVKIT_PASSWORD }
        : {}),
    },
    watch: { ...defaultConfig.watch, ...parsed.watch },
    preview: { ...defaultConfig.preview, ...parsed.preview },
    plugin: { ...defaultConfig.plugin, ...parsed.plugin },
    file,
    directory: dirname(file),
  };
}

export function applyFlagOverrides(config, flags) {
  const next = structuredClone(config);
  if (flags.host !== undefined) {
    const host = String(flags.host).trim();
    if (!host || /[\/\s]/.test(host)) throw new Error(`Invalid host: ${flags.host}`);
    next.nota.host = host;
  }
  if (flags.port !== undefined) {
    const port = Number(flags.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error(`Invalid port: ${flags.port}`);
    }
    next.nota.port = port;
  }
  if (flags.token !== undefined) next.nota.token = flags.token;
  if (flags.password !== undefined) next.nota.password = flags.password;
  if (flags.debounce !== undefined) {
    const debounceMs = Number(flags.debounce);
    if (!Number.isFinite(debounceMs) || debounceMs < 0) {
      throw new Error(`Invalid debounce value: ${flags.debounce}`);
    }
    next.watch.debounceMs = debounceMs;
  }
  if (flags.timeout !== undefined) {
    const timeoutMs = Number(flags.timeout);
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      throw new Error(`Invalid timeout value: ${flags.timeout}`);
    }
    next.nota.timeoutMs = timeoutMs;
  }
  return next;
}

export function resolveWatchTargets(config, positionals) {
  const requested =
    positionals.length > 0 ? positionals : config.watch.paths;
  const base = config.file ? config.directory : process.cwd();
  const paths = (requested.length > 0 ? requested : ["."]).map((item) =>
    resolve(base, item),
  );
  return [...new Set(paths)];
}

export function packageVersion() {
  const packageFile = fileURLToPath(new URL("../package.json", import.meta.url));
  return readFile(packageFile, "utf8").then(
    (source) => JSON.parse(source).version,
  );
}
