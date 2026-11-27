# Nota Host Control protocol v1

## Transport

- HTTP over TCP
- Default port: `17321`
- JSON request and response bodies
- Required request content type: `application/json`
- Default bind address: `127.0.0.1`
- Default whitelist: `127.0.0.1` and `::1`

The listener is created only while developer mode and the developer bridge are both enabled. A non-loopback whitelist can expose the listener to a local network; the transport is currently plain HTTP.

Every authenticated request uses a bearer token returned by `/v1/auth`.

## Health

```http
GET /v1/health
Host: 127.0.0.1:17321
```

```json
{
  "ok": true,
  "protocol": 1,
  "app": "nota-dev",
  "version": "0.14.0-beta",
  "features": [
    "documents.list",
    "editor.status",
    "theme.reload",
    "plugin.reload",
    "commands.invoke",
    "preview.render",
    "input.play",
    "capture.window"
  ]
}
```

Health does not create a session. Host methods still require authentication.

## Authentication

```http
POST /v1/auth
Content-Type: application/json

{"password":"your debug password"}
```

```json
{
  "ok": true,
  "token": "64-character hex token"
}
```

Passwords are verified against an Argon2 hash in the Nota config directory. A client IP is limited to eight failed authentication attempts per minute.

Tokens are random 256-bit values held in memory. They expire after 12 hours, are bound to the authenticating IP, and are cleared when the bridge stops or the user selects “Disconnect all”.

## RPC

```http
POST /v1/rpc
Content-Type: application/json
Authorization: Bearer <token>

{
  "method": "theme.reload",
  "params": {
    "path": "/home/user/project/theme/theme.css"
  }
}
```

Success:

```json
{
  "ok": true,
  "result": {
    "queued": true
  }
}
```

Failure:

```json
{
  "ok": false,
  "error": {
    "code": "rpc_failed",
    "message": "Could not read theme.css"
  }
}
```

Malformed requests and authentication failures use non-200 HTTP status codes. A valid authenticated RPC that fails in the host returns HTTP 200 with `ok: false`.

## Methods

| Method | Parameters | Result |
|---|---|---|
| `app.info` | none | App version, protocol, document count and plugin API version |
| `editor.status` | none | App version, active-document summary and all open-document summaries |
| `documents.list` | none | Open document summaries |
| `documents.read` | optional `id` | Markdown from the live editor mirror |
| `documents.write` | `text`, optional `id` | Replaces a live document through the editor event path |
| `documents.open` | `path` | Requests that Nota open a file |
| `commands.invoke` | `command`, optional `args` | Invokes a registered `nota_*` Tauri command in the WebView |
| `preview.render` | `markdown`, `title`, optional `themeCss` | Returns a complete HTML document from Nota's export pipeline |
| `input.play` | `actions`, optional default `interval` | Replays text, key, shortcut, wait, focus, click and editor-command actions in the live editor |
| `theme.reload` | CSS file or theme directory `path` | Reads CSS and applies it to the running document |
| `plugin.reload` | file or directory `path` | Transactionally reloads an installed extension |
| `plugin.inspect` | extension directory or `plugin.toml` path | Parsed manifest and declared capabilities |
| `diagnostics.info` | none | Version, target, log state, host diagnostics and document tools |
| `logs.read` | optional byte `offset` | Incremental debug log text |
| `settings.read` | none | Current settings |
| `settings.write` | complete `settings` object | Validates, saves and applies settings |
| `capture.window` | optional window `title` | PNG path, MIME type and base64 payload |

`commands.invoke` rejects non-`nota_` names and reserved bridge lifecycle commands. Other commands retain their ordinary host permissions; the authenticated bridge is therefore equivalent to local developer access.

## Input playback

`input.play` sends a deterministic action script to the active Nota WebView. It
uses the same editor focus, text input and keyboard event path as a local user.
The bridge does not record the screen. Use the operating system recorder when
the script is used for a demonstration video.

```json
{
  "actions": [
    { "type": "focus" },
    { "type": "text", "text": "# Nota", "interval": 70 },
    { "type": "key", "key": "Enter" },
    { "type": "text", "text": "A focused Markdown workspace.", "interval": 30 },
    { "type": "shortcut", "keys": "Ctrl+B" },
    { "type": "wait", "ms": 500 }
  ]
}
```

Supported actions:

| Type | Fields | Behavior |
|---|---|---|
| `text` | `text`, optional `interval`, optional `instant` | Inserts native text at the caret; the default is grapheme-by-grapheme playback |
| `key` | `key`, optional `count`, optional `modifiers` | Dispatches a keydown event and applies an editing fallback for Enter, Backspace, Delete and Tab |
| `shortcut` | `keys`, optional `count` | Parses forms such as `Ctrl+B`, `Meta+K` and `Mod+S` |
| `wait` | `ms` | Pauses playback without blocking the UI |
| `focus` | none | Focuses the active editor |
| `click` | CSS `selector` | Clicks one element in the Nota UI |
| `command` | `name`, optional `payload` | Runs an editor command through the active editor handle |

Modifiers are `altKey`, `ctrlKey`, `metaKey` and `shiftKey`. A new playback
request cancels the previous request in the same window.

## Preview rendering

`preview.render` is intentionally implemented in the Nota WebView. It calls the same `exportHtml` function used by HTML export, so the preview includes the active renderer, KaTeX, syntax highlighting, Mermaid, GitHub Alerts and sanitized HTML blocks.

Example:

```json
{
  "method": "preview.render",
  "params": {
    "markdown": "# Hello\n\n$$x^2$$",
    "title": "note.md",
    "themeCss": ":root { --font-doc: serif; }"
  }
}
```

## Request limits

- Body limit: 64 MiB
- Concurrent requests: 32
- WebView command timeout: 30 seconds
- Input playback timeout: 15 minutes
- Input playback limits: 10,000 actions and 1,000,000 text bytes
- Session lifetime: 12 hours
- Authentication failures: 8 per IP per minute

## Host validation

The Host header must match the connected peer IP or be `localhost` for a loopback peer. POST requests without `application/json` are rejected. This blocks browser form posts and DNS-rebinding requests from reaching password verification or RPC handlers.
