const valueFlags = new Set([
  "config",
  "host",
  "port",
  "token",
  "password",
  "debounce",
  "timeout",
  "theme",
  "file",
  "text",
  "width",
  "height",
  "title",
]);

const booleanFlags = new Set([
  "json",
  "help",
  "version",
  "no-color",
  "once",
  "no-open",
  "host-path",
]);

export function parseArgs(argv) {
  const command = argv[0] && !argv[0].startsWith("-") ? argv[0] : "";
  const rest = command ? argv.slice(1) : argv;
  const flags = {};
  const positionals = [];

  for (let index = 0; index < rest.length; index += 1) {
    const value = rest[index];
    if (value === "--") {
      positionals.push(...rest.slice(index + 1));
      break;
    }
    if (!value.startsWith("-")) {
      positionals.push(value);
      continue;
    }
    if (!value.startsWith("--")) {
      throw new Error(`Unknown short option: ${value}`);
    }

    const [rawName, inlineValue] = value.slice(2).split("=", 2);
    const name = rawName === "no-color" ? "no-color" : rawName;
    if (valueFlags.has(name)) {
      const next = inlineValue ?? rest[index + 1];
      if (next === undefined || (inlineValue === undefined && next.startsWith("-"))) {
        throw new Error(`Option --${name} requires a value`);
      }
      flags[name] = next;
      if (inlineValue === undefined) index += 1;
      continue;
    }
    if (booleanFlags.has(name)) {
      if (inlineValue !== undefined) {
        throw new Error(`Option --${name} does not take a value`);
      }
      flags[name] = true;
      continue;
    }
    throw new Error(`Unknown option: --${name}`);
  }

  return { command, flags, positionals };
}
