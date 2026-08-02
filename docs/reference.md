# Reference

*Diátaxis: reference — options, API, and messages.*

## Options

| Option       | Default | Description                                                        |
| ------------ | ------- | ------------------------------------------------------------------ |
| `limit`      | `500`   | Max flows kept in the ring buffer.                                 |
| `ui`         | `true`  | Mount the panel. `false` = headless capture only.                  |
| `open`       | `false` | Start with the panel open vs. collapsed.                           |
| `hideSystem` | `true`  | Hide internal Seneca framework messages by default.                |
| `remotePins` | `null`  | Message keys marking a remote call, e.g. `'aim:*'` or `['aim']`.   |
| `shortcut`   | `true`  | Ctrl+backtick toggles the panel.                                   |
| `width`      | `480`   | Initial panel width (px).                                          |
| `height`     | `360`   | Initial panel height (px).                                         |

## Panel

Tabs:

- **Messages** — live flow log: pattern, direction (local vs. remote per
  `remotePins`), `ok`/`err`/`timeout`, duration; click a row for the full
  request/response payloads. Pattern filter, hide-system toggle, pause,
  clear.
- **Config** — resolved Seneca options + loaded plugins.
- **Store** — the `@voxgig/seneca-browser-store` cache tree, when that
  plugin is present (loosely-coupled via its messages; the tab reports
  absence otherwise), with a clear-cache control.

Launcher: 🛰 bottom-right (`position: fixed`); **Ctrl+`** toggles.

## Programmatic API

```js
const api = seneca.export('browser-debug/api')
```

| Method | Description |
|---|---|
| `api.flows()` | Snapshot of captured flow records |
| `api.clear()` | Empty the buffer |
| `api.config()` | `{ options, plugins, ... }` |
| `api.pause(flag)` | Stop/resume capture |
| `api.toggle()` | Show/hide the panel |

## Messages

| Message | Description |
|---|---|
| `sys:browser-debug,get:flows` | Captured flows |
| `sys:browser-debug,clear:flows` | Empty the buffer |
| `sys:browser-debug,get:config` | Options + plugins |
