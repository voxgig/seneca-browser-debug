# Agent guide: @voxgig/seneca-browser-debug

In-window devtools panel for browser Seneca (message flows / config /
store cache). Concepts: [README.md](README.md) + [docs/](docs/).

## Commands

```bash
npm test        # node:test (test/capture.test.js)
```

Plain JS, no build step: `browser-debug.js` is the source AND the shipped
artifact (plus `browser-debug.d.ts`). Works as ESM import and global
script tag.

## Hard rules

- **Capture stays on public API**: `seneca.sub({ out$: true })`,
  `seneca.options()`, `seneca.list_plugins()`. Never monkey-patch Seneca
  internals; never capture the plugin's own `sys:browser-debug` control
  messages.
- **`.sbd-launch` / `.sbd-panel` must keep `position: fixed`** — without
  it the launcher renders below the viewport on tall (100vh) app shells
  and is unclickable. This was a real shipped bug (fixed in 0.1.1); a
  todo-app e2e (`debug.spec.js`) covers clicking the launcher on the
  enterprise shell.
- **Store tab stays loosely coupled** — talk to browser-store only via
  its `sys:browser-store,*` messages; no import, and it must degrade
  gracefully when the store plugin is absent.
- Consumers may vendor a copy (e.g. todo-app `web/public/`); after
  changing `browser-debug.js`, check known consumers for a stale vendored
  copy.

## Gotchas

- Error flows: eraro-based errors can carry null `details` — guard
  derefs (an eraro < 3.1.1 bug crashed on this).
- Publishing: direct `npm publish` (needs interactive browser 2FA).
