# How-to guides

*Diátaxis: how-to — recipes for common tasks. Options detail:
[reference](reference.md).*

## Use as a script tag (no bundler)

```html
<script src="/seneca-browser.js"></script>
<script src="/seneca-browser-debug.js"></script>
<script>
  const seneca = Seneca({ legacy: false })
    .client({ type: 'browser', pin: 'aim:*' })
  seneca.use(SenecaBrowserDebug, { remotePins: 'aim:*' })
</script>
```

## Capture without a UI (headless)

For tests or remote diagnostics, capture flows without mounting the panel:

```js
seneca.use(SenecaBrowserDebug, { ui: false, remotePins: 'aim:*' })
// later:
const flows = seneca.export('browser-debug/api').flows()
```

## Show framework-internal messages

They are hidden by default; show them per-session with the panel's
checkbox, or by default:

```js
seneca.use(SenecaBrowserDebug, { hideSystem: false })
```

## Start open / bigger / without the shortcut

```js
seneca.use(SenecaBrowserDebug, {
  open: true, width: 720, height: 480, shortcut: false,
})
```

## Drive the panel from code or tests

```js
const api = seneca.export('browser-debug/api')
api.toggle()       // show/hide
api.pause(true)    // freeze capture while inspecting
api.clear()        // empty the buffer
```

The same operations are available as messages
(`sys:browser-debug,get:flows` etc.) — see the [reference](reference.md).
