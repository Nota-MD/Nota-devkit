const colors = {
  dim: "\u001b[2m",
  red: "\u001b[31m",
  yellow: "\u001b[33m",
  green: "\u001b[32m",
  cyan: "\u001b[36m",
  reset: "\u001b[0m",
};

export function createLogger(options = {}) {
  const useColor =
    options.color !== false &&
    options.json !== true &&
    process.stdout.isTTY === true;
  const paint = (name, value) =>
    useColor ? `${colors[name]}${value}${colors.reset}` : value;
  const stamp = () =>
    options.timestamps === false ? "" : `${new Date().toISOString()} `;

  return {
    info(message) {
      console.log(`${paint("dim", stamp())}${message}`);
    },
    success(message) {
      console.log(`${paint("dim", stamp())}${paint("green", message)}`);
    },
    warn(message) {
      console.warn(`${paint("dim", stamp())}${paint("yellow", message)}`);
    },
    error(message) {
      console.error(`${paint("dim", stamp())}${paint("red", message)}`);
    },
    event(message) {
      console.log(`${paint("dim", stamp())}${paint("cyan", message)}`);
    },
  };
}
