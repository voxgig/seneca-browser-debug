# Tutorial: debug a browser Seneca app

*Diátaxis: tutorial — add the devtools to an app and follow a message
through them.*

## 1. Add the plugin

```js
import Seneca from '@seneca/browser'
import SenecaBrowserDebug from '@voxgig/seneca-browser-debug'

const seneca = Seneca({ legacy: false })
  .client({ type: 'browser', pin: 'aim:*' })

seneca.use(SenecaBrowserDebug, { remotePins: 'aim:*' })
```

`remotePins` tells the panel which message keys mean "this went to the
backend", so flows can be labelled local vs. remote.

## 2. Open the panel

Reload the page. A small 🛰 launcher sits in the bottom-right corner —
click it, or press **Ctrl+`**. Drag the header to move the panel; drag
the bottom-right corner to resize.

## 3. Follow a message

Trigger any action in your app (or run one from the console):

```js
seneca.post('aim:todo,list:item')
```

The **Messages** tab shows the flow live: its pattern, direction
(local/remote), `ok`/`err`/`timeout` status, and duration. Click the row
to expand the full request and response payloads. Use the filter box to
narrow by pattern; framework-internal messages are hidden by default.

## 4. Inspect config and state

- **Config** — the resolved Seneca options and loaded plugins.
- **Store** — if [`@voxgig/seneca-browser-store`](https://github.com/voxgig/seneca-browser-store)
  is loaded, the live cache as a tree (with a clear button). Perform a
  write in the app and watch the cached group update optimistically.

## 5. Keep it out of production

```js
if (import.meta.env.DEV) {
  seneca.use(SenecaBrowserDebug, { remotePins: 'aim:*' })
}
```
