# Verification

## Automated

```bash
npm run check:syntax
npm test
node ./bin/nota-devkit.mjs --help
```

Nota checks used for this integration:

```bash
cargo test --lib
npm run typecheck
npm run build
bash tools/i18n-check.sh
```

## Real-window pass

The following passed in an isolated Xvfb session with a temporary Nota config:

1. The five bridge warnings appeared in sequence.
2. Each step requested the displayed randomized number.
3. Numeric buttons changed positions between steps.
4. The credential form accepted password, port and the default IPv4/IPv6 loopback whitelist.
5. Enabling the bridge reported port `17321` and zero sessions.
6. DevKit authenticated and read the health/capability list.
7. `app.info`, `editor.status`, `documents.list`, `commands.invoke`, `logs.read`, `plugin.inspect` and `theme.reload` succeeded.
8. `preview.render` returned a complete 1.5 MiB Nota HTML document containing KaTeX, code and Mermaid.
9. Markdown preview re-rendered after the source file changed.
10. An unauthenticated RPC returned HTTP `401`.
11. A mismatched Host header returned HTTP `403`.
12. “Disconnect all” invalidated an existing token.
13. Disabling developer mode stopped both `127.0.0.1:17321` and `[::1]:17321`.
14. The credential file was mode `0600` and contained only the Argon2 hash.
15. `status` returned the active unsaved document and all open document summaries.
16. `read active` returned the live Markdown, including unsaved content.
17. `write active` changed the document and advanced its revision.
18. `open /tmp/remote-open.md` opened a second tab and made it active.

## Manual desktop checks

These require a normal window manager or a packaged build:

- `capture.window` on Linux X11/Wayland and Windows.
- LAN whitelist access from a second trusted device.
- Password and port persistence after a full application restart.
- Preview App-mode title bar on the packaged browser/desktop environment.
- Windows packaged build smoke test.
