# Development rules

- Keep identifiers and code comments in minimal English.
- User-facing documentation is primarily Chinese.
- Do not add a build step until the Node-native workflow is insufficient.
- Do not duplicate Nota's theme renderer or Lua runtime.
- Keep local development endpoints opt-in and loopback-only.
- Keep the CLI dependency-free unless a dependency removes substantial risk.
- Run `npm test` and `npm run check:syntax` before considering a change complete.
