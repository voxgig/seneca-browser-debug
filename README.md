# @seneca/browser-debug

In-window developer devtools for [Seneca][] running in the browser — a
resizable, draggable, hideable pop-up panel that shows live **message flows**
and **config**, similar in spirit to the Vue/React devtools but **not a
browser extension**. It injects itself into the page, so it works on any
device and any browser with no install.

It is a support plugin for [`@seneca/browser`][seneca-browser].

## What it shows

- **Messages** — a live log of every Seneca message: pattern, direction
  (local vs. remote/backend), `ok`/`err`/`timeout` status, duration, and the
  full request/response payloads (click a row to expand). Filter by pattern,
  hide framework-internal messages, pause, and clear.
- **Config** — the resolved Seneca options and the list of loaded plugins.

## Install

```sh
npm install @seneca/browser-debug
```

## Usage

### As a script tag (alongside `seneca-browser.js`)

```html
<script src="/seneca-browser.js"></script>
<script src="/seneca-browser-debug.js"></script>
<script>
  const seneca = Seneca({ legacy: false })
    .client({ type: 'browser', pin: 'aim:*' })

  seneca.use(SenecaBrowserDebug, { remotePins: 'aim:*' })
</script>
```

### As an ESM / bundler import (e.g. Vite)

```js
import Seneca from '@seneca/browser'
import SenecaBrowserDebug from '@seneca/browser-debug'

const seneca = Seneca({ legacy: false }).client({ type: 'browser', pin: 'aim:*' })
seneca.use(SenecaBrowserDebug, { remotePins: 'aim:*' })
```

The panel starts collapsed to a small 🛰 launcher in the bottom-right corner.
Click it (or press **Ctrl+`**) to open. Drag the header to move it; drag the
bottom-right corner to resize.

Enable it only in development, e.g.:

```js
if (import.meta.env.DEV) {
  seneca.use(SenecaBrowserDebug, { remotePins: 'aim:*' })
}
```

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

## Programmatic API

The plugin exports an `api` object (also driveable via messages):

```js
const api = seneca.export('browser-debug/api')
api.flows()        // snapshot of captured flow records
api.clear()        // empty the buffer
api.config()       // { options, plugins, ... }
api.pause(true)    // stop/resume capture
api.toggle()       // show/hide the panel
```

Equivalent messages: `sys:browser-debug,get:flows`,
`sys:browser-debug,clear:flows`, `sys:browser-debug,get:config`.

## How capture works

Capture uses Seneca's public `seneca.sub({ out$: true }, ...)` subscription,
firing once per completed message with the message, result and meta (timing,
pattern, error flag). The debugger never captures its own control messages.
Config is read via `seneca.options()` and `seneca.list_plugins()`. No
monkey-patching of Seneca internals.

## License

MIT

[Seneca]: https://senecajs.org
[seneca-browser]: https://github.com/voxgig/seneca-browser
