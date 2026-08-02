# Explanation

*Diátaxis: explanation — the design decisions behind the devtools.*

## Public subscription, no monkey-patching

Capture uses Seneca's public `seneca.sub({ out$: true }, ...)`
subscription, which fires once per completed message with the message,
result, and meta (timing, pattern, error flag). Config is read via
`seneca.options()` and `seneca.list_plugins()`. Nothing in Seneca's
internals is patched — so the debugger cannot change the behaviour it
observes, and it keeps working across Seneca versions that preserve the
public API. The debugger also never captures its own control messages,
avoiding observation feedback loops.

## In-page panel, not a browser extension

Extensions have distribution and permission costs, and don't exist at all
on mobile browsers or embedded webviews. Injecting a plain DOM panel means
the devtools travel with the app bundle (gated behind a dev flag),
identical on every device. The launcher and panel use `position: fixed` so
they stay visible on tall app-shell pages regardless of page scroll or
layout.

## Loose coupling to the store

The **Store** tab talks to `@voxgig/seneca-browser-store` purely through
its public messages (`sys:browser-store,get:state` / `clear:store`). No
import, no hard dependency: with the store absent the tab degrades to a
notice. This is the same message-first philosophy as the rest of the
stack — integration points are patterns, not module references.

## A ring buffer, deliberately

Flows land in a bounded ring buffer (`limit`, default 500). Debugging
sessions are open-ended; an unbounded log would leak memory in exactly the
long sessions where devtools matter most. Pause freezes capture when you
need to inspect a moment in time.
