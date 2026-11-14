# Design

## Goal

Nota DevKit shortens the theme, plugin and preview feedback loop without creating a second renderer.

Nota remains the source of truth for rendering, themes and Lua execution. DevKit watches files, validates obvious source errors, authenticates to the real Nota process, and asks that process to perform reloads or render a preview.

## Components

```text
Editor
  saves CSS, Lua, Markdown or assets

Nota DevKit
  watches files
  classifies changes
  validates source
  authenticates
  calls Host Control

Nota
  applies document CSS
  transactionally reloads Lua
  renders Markdown through exportHtml
  captures its own or another window
```

The bridge lives in the normal Nota build but is dormant unless developer mode and the bridge setting are both enabled. This keeps one application binary and one renderer while making privileged access explicit.

## Preview

The preview window is a browser in App mode. It has no Nota editor chrome and no DevKit controls. A local server sends the exported HTML and a live-reload event stream.

For Markdown, the server repeatedly calls `preview.render`. Nota's WebView executes `exportHtml`, including the active document theme. This guarantees that preview code blocks, math, Mermaid, tables and HTML blocks follow the same pipeline as exported HTML.

For an existing HTML file, DevKit injects the selected CSS before returning the page.

The window title prefers the open CSS filename so that a window such as `theme.css — Nota Preview` identifies both the content and the stylesheet being developed.

## Security model

Host Control grants the same practical access as a local developer process. The protection layers are:

1. Developer mode must already be enabled.
2. The bridge is off by default.
3. Five randomized warning steps must be completed.
4. An Argon2 password is mandatory.
5. The client IP must match an address or CIDR entry.
6. A bearer session is required for every RPC.
7. Failed authentication is rate-limited.
8. Sessions can be revoked immediately.
9. Host and content-type validation block simple browser-originated requests.

The default listener is loopback-only. A LAN whitelist extension is available for remote-device testing, but plain HTTP is not suitable for untrusted networks. A future transport should add TLS or a challenge-response layer before treating LAN access as a secure remote API.

## Reload invariants

1. A theme reload keeps document text, caret, selection and undo history.
2. A failed Lua reload keeps the previous extension instance alive.
3. Duplicate filesystem events are collapsed.
4. A failed bridge call leaves the latest watch event queued for retry.
5. The public `--mcp` entry and MCP socket transport are absent; internal document helpers are reused only by the authenticated bridge.

## Protocol boundaries

The bridge does not expose the password hash, session tokens, arbitrary URL downloads or arbitrary subprocess execution as new primitives. Generic `commands.invoke` delegates to Nota's existing registered commands, which remain responsible for their own path, capability and confirmation checks.

The DevKit is not packaged with Nota. It is an external tool with no build step and no third-party runtime dependency.
