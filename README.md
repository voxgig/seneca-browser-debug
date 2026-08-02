# @voxgig/seneca-browser-debug

In-window developer devtools for [Seneca][] running in the browser — a
resizable, draggable, hideable pop-up panel that shows live **message
flows**, **config**, and (with [`@voxgig/seneca-browser-store`][browser-store])
the **store cache**. Similar in spirit to the Vue/React devtools but **not
a browser extension**: it injects itself into the page, so it works on any
device and any browser with no install.

It is a support plugin for [`@seneca/browser`][seneca-browser].

## Install

```sh
npm install @voxgig/seneca-browser-debug
```

## Quick start

```js
import Seneca from '@seneca/browser'
import SenecaBrowserDebug from '@voxgig/seneca-browser-debug'

const seneca = Seneca({ legacy: false }).client({ type: 'browser', pin: 'aim:*' })

if (import.meta.env.DEV) {
  seneca.use(SenecaBrowserDebug, { remotePins: 'aim:*' })
}
```

The panel starts collapsed to a small 🛰 launcher in the bottom-right
corner. Click it (or press **Ctrl+`**) to open; drag the header to move,
drag the bottom-right corner to resize.

## Documentation

Organised by the [Diátaxis](https://diataxis.fr) framework:

- **Tutorial**: [Debug a browser Seneca app](docs/tutorial.md)
- **How-to guides**: [Common tasks](docs/how-to.md) — script-tag setup,
  headless capture, filtering, driving the panel from code
- **Reference**: [Options, API, messages](docs/reference.md)
- **Explanation**: [How capture works](docs/explanation.md)

Working on this repo with an AI agent? See [AGENTS.md](AGENTS.md).

## License

MIT

[Seneca]: https://senecajs.org
[seneca-browser]: https://github.com/voxgig/seneca-browser
[browser-store]: https://github.com/voxgig/seneca-browser-store
