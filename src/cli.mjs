import { isAbsolute, resolve } from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "./args.mjs";
import { checkTargets } from "./check.mjs";
import {
  applyFlagOverrides,
  loadConfig,
  packageVersion,
  resolveWatchTargets,
} from "./config.mjs";
import { createLogger } from "./log.mjs";
import {
  formatDocuments,
  formatStatus,
  getEditorStatus,
  checkExtensionUpdates,
  installExtension,
  listExtensions,
  openDocument,
  parseDocumentId,
  readDocument,
  setExtensionEnabled,
  uninstallExtension,
  updateAllExtensions,
  updateExtension,
  writeDocument,
} from "./control.mjs";
import { runPreview } from "./preview.mjs";
import { call } from "./protocol.mjs";
import { playInput, readInputScript } from "./input.mjs";
import { doctor, runWatch } from "./watch.mjs";

function helpText() {
  return `Nota DevKit

Usage:
  nota-devkit watch [paths...] [options]
  nota-devkit check [paths...] [options]
  nota-devkit doctor [options]
  nota-devkit preview <html-or-markdown-file> [options]
  nota-devkit status [options]
  nota-devkit documents [options]
  nota-devkit read [id|active] [options]
  nota-devkit write [id|active] (--text <text> | --file <path>) [options]
  nota-devkit open <absolute-path> [options]
  nota-devkit input <script.json> [options]
  nota-devkit info [options]
  nota-devkit capture [output.png] [options]
  nota-devkit logs [offset] [options]
  nota-devkit inspect <plugin-directory> [options]
  nota-devkit extension list [options]
  nota-devkit extension install <file> [--host-path] [options]
  nota-devkit extension uninstall <id> [options]
  nota-devkit extension enable <id> [options]
  nota-devkit extension disable <id> [options]
  nota-devkit extension updates [options]
  nota-devkit extension update <id|all> [options]
  nota-devkit rpc <method> [json-params] [options]

Options:
  --config <file>    Use a specific .nota-devkit.json
  --host <address>   Override the Nota Dev bridge host
  --port <port>      Override the Nota Dev bridge port
  --token <token>    Override the local bridge token
  --password <text>  Developer bridge password
  --debounce <ms>    Override the file event debounce
  --timeout <ms>     Override bridge request timeout
  --theme <file>     Override the preview theme stylesheet
  --width <px>       Preview window width
  --height <px>      Preview window height
  --title <text>     Window title; defaults to the HTML filename
  --text <text>      Replacement text for the write command
  --file <path>      Read replacement text from a local file
  --host-path        Treat the extension path as a path on the Nota host
  --no-open          Serve the preview without launching a browser
  --json             Emit machine-readable check output
  --no-color         Disable terminal colors
  --help             Show this help
  --version          Show the version
`;
}

function printIssues(issues, flags) {
  if (flags.json) {
    console.log(JSON.stringify({ issues }, null, 2));
    return;
  }
  for (const item of issues) {
    const label = item.level === "error" ? "ERROR" : "WARN ";
    console.log(`${label} ${item.file}\n      ${item.message}`);
  }
  const errors = issues.filter((item) => item.level === "error").length;
  const warnings = issues.filter((item) => item.level === "warning").length;
  console.log(`\n${errors} error(s), ${warnings} warning(s)`);
}

export async function runCli(argv = process.argv.slice(2)) {
  const parsed = parseArgs(argv);
  const logger = createLogger({
    color: parsed.flags["no-color"] !== true,
    json: parsed.flags.json === true,
  });

  if (parsed.flags.version) {
    console.log(await packageVersion());
    return 0;
  }
  if (parsed.flags.help || !parsed.command) {
    process.stdout.write(helpText());
    return parsed.command ? 0 : 2;
  }
  if (![
    "watch", "check", "doctor", "preview", "status", "documents", "read",
    "write", "open", "input", "info", "capture", "logs", "inspect", "extension", "rpc", "attach",
  ].includes(parsed.command)) {
    logger.error(`Unknown command: ${parsed.command}`);
    process.stdout.write(helpText());
    return 2;
  }

  const config = applyFlagOverrides(
    await loadConfig({ file: parsed.flags.config }),
    parsed.flags,
  );
  if (parsed.flags["no-open"]) config.preview.open = false;
  if (parsed.flags.width) config.preview.windowWidth = Number(parsed.flags.width);
  if (parsed.flags.height) config.preview.windowHeight = Number(parsed.flags.height);
  if (parsed.flags.title) config.preview.title = parsed.flags.title;
  if (parsed.command === "check") {
    const targets = resolveWatchTargets(config, parsed.positionals);
    const result = await checkTargets(targets, {
      apiVersion: config.plugin.apiVersion,
    });
    printIssues(result.issues, parsed.flags);
    return result.failed ? 1 : 0;
  }
  if (parsed.command === "doctor" || parsed.command === "attach") {
    try {
      const health = await doctor(config, logger, {
        quiet: parsed.flags.json === true,
      });
      if (parsed.flags.json) console.log(JSON.stringify(health, null, 2));
      return 0;
    } catch {
      return 1;
    }
  }
  if (parsed.command === "status" || parsed.command === "documents") {
    try {
      const status = await getEditorStatus(config);
      if (parsed.flags.json) {
        console.log(JSON.stringify(
          parsed.command === "status" ? status : status.documents,
          null,
          2,
        ));
      } else {
        console.log(
          parsed.command === "status"
            ? formatStatus(status)
            : formatDocuments(status.documents),
        );
      }
      return 0;
    } catch (error) {
      logger.error(error instanceof Error ? error.message : String(error));
      return 1;
    }
  }
  if (parsed.command === "read") {
    try {
      const id = parseDocumentId(parsed.positionals[0]);
      const document = await readDocument(config, id);
      if (parsed.flags.json) {
        console.log(JSON.stringify(document, null, 2));
      } else {
        process.stdout.write(document.text);
        if (document.text && !document.text.endsWith("\n")) {
          process.stdout.write("\n");
        }
      }
      return 0;
    } catch (error) {
      logger.error(error instanceof Error ? error.message : String(error));
      return 1;
    }
  }
  if (parsed.command === "write") {
    try {
      const id = parseDocumentId(parsed.positionals[0]);
      if (parsed.flags.text !== undefined && parsed.flags.file !== undefined) {
        throw new Error("write accepts either --text or --file, not both");
      }
      let text;
      if (parsed.flags.file !== undefined) {
        const file = resolve(
          config.file ? config.directory : process.cwd(),
          parsed.flags.file,
        );
        text = await readFile(file, "utf8");
      } else if (parsed.flags.text !== undefined) {
        text = String(parsed.flags.text);
      } else {
        throw new Error("write requires --text or --file");
      }
      const result = await writeDocument(config, id, text);
      if (parsed.flags.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        logger.success(
          `Updated document ${result.id} (revision ${result.revision}, ${result.chars} characters)`,
        );
      }
      return 0;
    } catch (error) {
      logger.error(error instanceof Error ? error.message : String(error));
      return 1;
    }
  }
  if (parsed.command === "open") {
    try {
      const path = parsed.positionals[0];
      if (!path) throw new Error("open requires a path");
      if (!isAbsolute(path)) {
        throw new Error("open requires an absolute path on the Nota host");
      }
      const result = await openDocument(config, path);
      console.log(JSON.stringify(result, null, 2));
      return 0;
    } catch (error) {
      logger.error(error instanceof Error ? error.message : String(error));
      return 1;
    }
  }
  if (parsed.command === "input") {
    try {
      const file = parsed.positionals[0];
      if (!file) throw new Error("input requires an input script file");
      const base = config.file ? config.directory : process.cwd();
      const script = await readInputScript(file, base);
      const result = await playInput(config, script);
      if (parsed.flags.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        logger.success(
          `Played ${result.played} action(s), ${result.characters} character(s), ` +
          `${result.durationMs} ms`,
        );
      }
      return 0;
    } catch (error) {
      logger.error(error instanceof Error ? error.message : String(error));
      return 1;
    }
  }
  if (parsed.command === "extension") {
    try {
      const action = parsed.positionals[0];
      const target = parsed.positionals[1];
      let result;
      if (action === "list" || action === "updates") {
        result =
          action === "list"
            ? await listExtensions(config)
            : await checkExtensionUpdates(config);
      } else if (action === "install") {
        if (!target) throw new Error("extension install requires a package file");
        result = await installExtension(config, target, {
          hostPath: parsed.flags["host-path"] === true,
        });
      } else if (action === "uninstall") {
        if (!target) throw new Error("extension uninstall requires an id");
        result = await uninstallExtension(config, target);
      } else if (action === "enable" || action === "disable") {
        if (!target) throw new Error(`extension ${action} requires an id`);
        result = await setExtensionEnabled(config, target, action === "enable");
      } else if (action === "update") {
        if (!target) throw new Error("extension update requires an id or all");
        result =
          target === "all"
            ? await updateAllExtensions(config)
            : await updateExtension(config, target);
      } else {
        throw new Error(
          "extension action must be list, install, uninstall, enable, disable, updates or update",
        );
      }
      console.log(JSON.stringify(result, null, 2));
      return 0;
    } catch (error) {
      logger.error(error instanceof Error ? error.message : String(error));
      return 1;
    }
  }
  if (parsed.command === "info") {
    try {
      const info = await call(config, "app.info");
      console.log(JSON.stringify(info, null, 2));
      return 0;
    } catch (error) {
      logger.error(error instanceof Error ? error.message : String(error));
      return 1;
    }
  }
  if (parsed.command === "capture") {
    try {
      const result = await call(config, "capture.window", {
        title: parsed.flags.title || "Nota",
      });
      const output = resolve(parsed.positionals[0] || "nota-window.png");
      await writeFile(output, Buffer.from(result.base64, "base64"));
      logger.success(`Screenshot: ${output}`);
      return 0;
    } catch (error) {
      logger.error(error instanceof Error ? error.message : String(error));
      return 1;
    }
  }
  if (parsed.command === "logs") {
    try {
      const offset = Number(parsed.positionals[0] || 0);
      if (!Number.isSafeInteger(offset) || offset < 0) {
        throw new Error("logs offset must be a non-negative integer");
      }
      const chunk = await call(config, "logs.read", { offset });
      if (parsed.flags.json) {
        console.log(JSON.stringify(chunk, null, 2));
      } else {
        if (chunk.reset) logger.warn("The debug log restarted; printing from the beginning.");
        process.stdout.write(chunk.text);
        if (chunk.text && !chunk.text.endsWith("\n")) process.stdout.write("\n");
        logger.info(`Offset: ${chunk.offset}`);
      }
      return 0;
    } catch (error) {
      logger.error(error instanceof Error ? error.message : String(error));
      return 1;
    }
  }
  if (parsed.command === "inspect" || parsed.command === "rpc") {
    const method =
      parsed.command === "inspect" ? "plugin.inspect" : parsed.positionals[0];
    if (!method) {
      logger.error(`${parsed.command} requires a method or plugin directory`);
      return 2;
    }
    let params = {};
    try {
      if (parsed.command === "inspect") {
        const base = config.file ? config.directory : process.cwd();
        params = { path: resolve(base, parsed.positionals[0] || ".") };
      } else if (parsed.positionals[1]) {
        params = JSON.parse(parsed.positionals[1]);
        if (!params || typeof params !== "object" || Array.isArray(params)) {
          throw new Error("rpc params must be a JSON object");
        }
      }
      const result = await call(config, method, params);
      console.log(JSON.stringify(result, null, 2));
      return 0;
    } catch (error) {
      logger.error(error instanceof Error ? error.message : String(error));
      return 1;
    }
  }
  if (parsed.command === "preview") {
    const html = parsed.positionals[0] ?? config.preview.entry;
    if (!html) {
      logger.error("preview requires an HTML or Markdown file");
      return 2;
    }
    const base = config.file ? config.directory : process.cwd();
    const htmlPath = resolve(base, html);
    const theme = parsed.flags.theme ?? config.preview.theme;
    const themePath = theme
      ? resolve(base, theme)
      : null;
    try {
      await runPreview(config, htmlPath, themePath, logger);
      return 0;
    } catch (error) {
      logger.error(error instanceof Error ? error.message : String(error));
      return 1;
    }
  }
  const targets = resolveWatchTargets(config, parsed.positionals);
  await runWatch(config, targets, logger);
  return 0;
}
