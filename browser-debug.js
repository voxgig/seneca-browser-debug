/* Copyright (c) 2026 Richard Rodger, MIT License. */

/*
 * @voxgig/seneca-browser-debug
 *
 * A Seneca plugin that adds an in-window developer console for Seneca
 * running in the browser. It is NOT a browser extension - it injects a
 * floating, draggable, resizable, hideable pop-up panel directly into
 * the page, showing:
 *
 *   - Messages: a live log of every Seneca message flow (pattern,
 *     direction local/remote, ok/err/timeout status, duration and the
 *     full request/response payloads).
 *   - Config: the resolved Seneca options and the list of loaded
 *     plugins.
 *
 * Usage (as a global script tag, alongside seneca-browser.js):
 *   <script src="/seneca-browser.js"></script>
 *   <script src="/seneca-browser-debug.js"></script>
 *   ...
 *   seneca.use(SenecaBrowserDebug, { remotePins: 'aim:*' })
 *
 * Usage (as an ESM/bundler import):
 *   import SenecaBrowserDebug from '@voxgig/seneca-browser-debug'
 *   seneca.use(SenecaBrowserDebug, { remotePins: 'aim:*' })
 */

;(function (root, factory) {
  'use strict'
  if (typeof module === 'object' && module.exports) {
    module.exports = factory()
  }
  else {
    root.SenecaBrowserDebug = factory()
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict'

  const DEFAULTS = {
    // Max number of captured flows kept in the ring buffer.
    limit: 500,
    // Mount the in-window panel (set false for headless capture only).
    ui: true,
    // Start with the panel open (vs. collapsed to the launcher button).
    open: false,
    // Hide internal Seneca framework messages by default.
    hideSystem: true,
    // Which top-level message keys indicate a remote (backend) call.
    // Accepts 'aim:*' or ['aim'] or 'aim:*,foo:*' etc.
    remotePins: null,
    // Ctrl+backtick toggles the panel.
    shortcut: true,
    // Initial panel geometry.
    width: 480,
    height: 360,
  }

  // A message is considered "system" (framework internal) if its pattern
  // contains any of these substrings.
  const SYSTEM_MATCHERS = [
    'role:seneca',
    'role:transport',
    'role:mem-store',
    'role:entity',
    'role:web',
    'role:basic',
    'role:util',
    'sys:seneca',
    'init:',
    'plugin:define',
    'on:point',
    'get:pathmap',
    'cmd:close',
    'sys:browser-debug',
  ]

  // ---- the Seneca plugin -------------------------------------------------

  function browser_debug(options) {
    const seneca = this
    const opts = Object.assign({}, DEFAULTS, options || {})
    const remoteKeys = normalizeRemotePins(opts.remotePins)

    const flows = []
    const buildRecord = makeRecordBuilder(remoteKeys)
    let paused = false
    const listeners = []

    function notify() {
      for (let i = 0; i < listeners.length; i++) {
        try {
          listeners[i]()
        }
        catch (e) {
          // A broken UI listener must never break message capture.
          if (typeof console !== 'undefined') {
            console.error('browser-debug listener failed', e)
          }
        }
      }
    }

    // Capture every completed message flow (except the debugger's own
    // control messages, so it never observes itself).
    seneca.sub({ out$: true }, function (msg, result, meta) {
      if (paused) {
        return
      }
      const pattern = (meta && meta.pattern) || ''
      if (pattern.indexOf('sys:browser-debug') >= 0) {
        return
      }
      flows.push(buildRecord(msg, result, meta))
      while (flows.length > opts.limit) {
        flows.shift()
      }
      notify()
    })

    function configSnapshot() {
      let plugins = []
      try {
        plugins = pluginList(seneca)
      }
      catch (e) {
        plugins = []
      }
      let senecaOptions = {}
      try {
        senecaOptions = sanitize(seneca.options(), 6)
      }
      catch (e) {
        senecaOptions = {}
      }
      return {
        id: seneca.id,
        version: seneca.version,
        start: seneca.start_time,
        options: senecaOptions,
        plugins: plugins,
        remoteKeys: remoteKeys.slice(),
      }
    }

    // Programmatic access (also convenient for headless tests).
    seneca.add('sys:browser-debug,get:flows', function (msg, reply) {
      reply({ ok: true, flows: flows.slice() })
    })
    seneca.add('sys:browser-debug,clear:flows', function (msg, reply) {
      flows.length = 0
      notify()
      reply({ ok: true })
    })
    seneca.add('sys:browser-debug,get:config', function (msg, reply) {
      reply({ ok: true, config: configSnapshot() })
    })

    const api = {
      flows: function () {
        return flows.slice()
      },
      clear: function () {
        flows.length = 0
        notify()
      },
      config: configSnapshot,
      pause: function (v) {
        paused = undefined === v ? !paused : !!v
        return paused
      },
      isPaused: function () {
        return paused
      },
      subscribe: function (fn) {
        listeners.push(fn)
        return function () {
          const i = listeners.indexOf(fn)
          if (i >= 0) {
            listeners.splice(i, 1)
          }
        }
      },
      // Filled in by the UI when mounted.
      toggle: function () {},
      show: function () {},
      hide: function () {},
    }

    // Loosely-coupled bridge to @voxgig/seneca-browser-store (if present): read and
    // clear its cache state tree. `get` yields null when no store plugin is
    // loaded (the action simply isn't found).
    const storeBridge = {
      get: function (cb) {
        try {
          seneca.act('sys:browser-store,get:state', function (err, out) {
            cb(!err && out && out.ok ? out : null)
          })
        }
        catch (e) {
          cb(null)
        }
      },
      clear: function (cb) {
        try {
          seneca.act('sys:browser-store,clear:store', function () {
            cb && cb()
          })
        }
        catch (e) {
          cb && cb()
        }
      },
    }

    if (opts.ui && typeof document !== 'undefined') {
      seneca.ready(function () {
        try {
          mountPanel(opts, api, flows, remoteKeys, storeBridge)
        }
        catch (e) {
          if (typeof console !== 'undefined') {
            console.error('browser-debug panel mount failed', e)
          }
        }
      })
    }

    return {
      name: 'browser-debug',
      exports: {
        api: api,
      },
    }
  }

  // ---- capture helpers ---------------------------------------------------

  function normalizeRemotePins(pins) {
    if (null == pins) {
      return []
    }
    const list = Array.isArray(pins) ? pins : String(pins).split(',')
    const keys = []
    for (let i = 0; i < list.length; i++) {
      const part = String(list[i]).trim()
      if ('' === part) {
        continue
      }
      // 'aim:*' -> 'aim' ; 'aim' -> 'aim'
      const key = part.split(':')[0].trim()
      if ('' !== key && keys.indexOf(key) < 0) {
        keys.push(key)
      }
    }
    return keys
  }

  // Build the per-flow record from Seneca's (msg, result, meta). Pure and
  // self-contained (owns its own sequence counter) so it can be unit-tested
  // without a live Seneca instance.
  function makeRecordBuilder(remoteKeys) {
    let seq = 0
    return function buildRecord(msg, result, meta) {
      meta = meta || {}
      const err = true === meta.error
      const start = meta.start
      const end = meta.end
      const duration = null != start && null != end ? end - start : null

      let status = err ? 'err' : 'ok'
      if (err && isTimeout(result)) {
        status = 'timeout'
      }

      const pattern = meta.pattern || patternOf(msg)

      return {
        seq: ++seq,
        time: null != end ? end : start,
        pattern: pattern,
        id: meta.id || null,
        dir: directionOf(msg, remoteKeys),
        status: status,
        duration: duration,
        system: isSystem(pattern),
        msg: sanitize(stripMarkers(msg)),
        result: sanitize(result),
        error: err ? errorText(result) : null,
      }
    }
  }

  function directionOf(msg, remoteKeys) {
    if (msg && remoteKeys.length > 0) {
      for (let i = 0; i < remoteKeys.length; i++) {
        if (Object.prototype.hasOwnProperty.call(msg, remoteKeys[i])) {
          return 'remote'
        }
      }
    }
    return 'local'
  }

  function isSystem(pattern) {
    if (!pattern) {
      return false
    }
    for (let i = 0; i < SYSTEM_MATCHERS.length; i++) {
      if (pattern.indexOf(SYSTEM_MATCHERS[i]) >= 0) {
        return true
      }
    }
    return false
  }

  function isTimeout(result) {
    if (!result) {
      return false
    }
    if ('action_timeout' === result.code) {
      return true
    }
    const m = result.message || result.msg
    return 'string' === typeof m && /timeout/i.test(m)
  }

  function errorText(result) {
    if (!result) {
      return 'error'
    }
    if ('string' === typeof result) {
      return result
    }
    return result.message || result.msg || result.code || 'error'
  }

  function patternOf(msg) {
    if (!msg) {
      return ''
    }
    const keys = Object.keys(msg)
      .filter(function (k) {
        return '$' !== k.charAt(k.length - 1) && 'object' !== typeof msg[k]
      })
      .sort()
    return keys
      .map(function (k) {
        return k + ':' + msg[k]
      })
      .join(',')
  }

  // Remove Seneca's control markers ($-suffixed keys) from a message copy.
  function stripMarkers(msg) {
    if (!msg || 'object' !== typeof msg) {
      return msg
    }
    const out = {}
    const keys = Object.keys(msg)
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i]
      if ('$' === k.charAt(k.length - 1)) {
        continue
      }
      out[k] = msg[k]
    }
    return out
  }

  // Deep, safe, bounded clone for display: strips functions, breaks
  // cycles, caps depth / array length / string length.
  function sanitize(value, maxDepth) {
    maxDepth = maxDepth || 5
    const seen = []

    function walk(v, depth) {
      if (null === v || undefined === v) {
        return v
      }
      const t = typeof v
      if ('function' === t) {
        return '[Function]'
      }
      if ('string' === t) {
        return v.length > 2000 ? v.slice(0, 2000) + '…' : v
      }
      if ('number' === t || 'boolean' === t) {
        return v
      }
      if ('object' !== t) {
        return String(v)
      }
      if (v instanceof Error) {
        return { error: v.message, code: v.code }
      }
      if (depth >= maxDepth) {
        return Array.isArray(v) ? '[Array]' : '[Object]'
      }
      if (seen.indexOf(v) >= 0) {
        return '[Circular]'
      }
      seen.push(v)
      let out
      if (Array.isArray(v)) {
        out = []
        const n = Math.min(v.length, 200)
        for (let i = 0; i < n; i++) {
          out.push(walk(v[i], depth + 1))
        }
        if (v.length > n) {
          out.push('… (' + (v.length - n) + ' more)')
        }
      }
      else {
        out = {}
        const keys = Object.keys(v)
        for (let i = 0; i < keys.length; i++) {
          const k = keys[i]
          if ('$' === k.charAt(k.length - 1)) {
            continue
          }
          out[k] = walk(v[k], depth + 1)
        }
      }
      seen.pop()
      return out
    }

    return walk(value, 0)
  }

  function pluginList(seneca) {
    const out = []
    let reg = null
    if ('function' === typeof seneca.list_plugins) {
      reg = seneca.list_plugins()
    }
    else if (seneca.plugins) {
      reg = seneca.plugins()
    }
    if (!reg) {
      return out
    }
    const keys = Object.keys(reg)
    const seen = {}
    for (let i = 0; i < keys.length; i++) {
      const p = reg[keys[i]]
      const fullname = (p && p.fullname) || keys[i]
      // list_plugins keys each plugin under both its name and fullname, so
      // dedup to a single chip per plugin.
      if (seen[fullname]) {
        continue
      }
      seen[fullname] = true
      out.push({
        name: (p && (p.name || p.fullname)) || keys[i],
        tag: (p && p.tag) || null,
        fullname: fullname,
      })
    }
    return out
  }

  // ---- the in-window panel UI -------------------------------------------

  const STYLE_ID = 'sbd-style'
  const STYLE = [
    '.sbd-root{position:fixed;z-index:2147483000;font:12px/1.45 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:#e6edf3}',
    '.sbd-launch{position:fixed;right:14px;bottom:14px;background:#161b22;color:#e6edf3;border:1px solid #30363d;border-radius:16px;padding:6px 12px;cursor:pointer;box-shadow:0 3px 12px rgba(0,0,0,.4);display:flex;gap:6px;align-items:center}',
    '.sbd-launch:hover{background:#21262d}',
    '.sbd-badge{background:#1f6feb;color:#fff;border-radius:9px;padding:0 6px;font-size:11px;min-width:16px;text-align:center}',
    '.sbd-panel{position:fixed;right:14px;bottom:14px;background:#0d1117;border:1px solid #30363d;border-radius:8px;box-shadow:0 8px 32px rgba(0,0,0,.55);display:flex;flex-direction:column;overflow:hidden;resize:both;min-width:320px;min-height:180px;max-width:96vw;max-height:92vh}',
    '.sbd-head{display:flex;align-items:center;gap:8px;padding:6px 8px;background:#161b22;border-bottom:1px solid #30363d;cursor:move;user-select:none}',
    '.sbd-title{font-weight:700;color:#58a6ff;white-space:nowrap}',
    '.sbd-tabs{display:flex;gap:4px}',
    '.sbd-tab{background:transparent;color:#8b949e;border:1px solid transparent;border-radius:5px;padding:2px 9px;cursor:pointer}',
    '.sbd-tab.sbd-on{color:#e6edf3;background:#21262d;border-color:#30363d}',
    '.sbd-sp{flex:1}',
    '.sbd-btn{background:#21262d;color:#c9d1d9;border:1px solid #30363d;border-radius:5px;padding:2px 8px;cursor:pointer}',
    '.sbd-btn:hover{background:#30363d}',
    '.sbd-btn.sbd-act{color:#f0b429;border-color:#9e6a03}',
    '.sbd-body{flex:1;overflow:auto;position:relative}',
    '.sbd-bar{display:flex;gap:8px;align-items:center;padding:5px 8px;border-bottom:1px solid #21262d;position:sticky;top:0;background:#0d1117;z-index:1;flex-wrap:wrap}',
    '.sbd-in{background:#010409;color:#e6edf3;border:1px solid #30363d;border-radius:5px;padding:3px 7px;flex:1;min-width:80px}',
    '.sbd-lbl{color:#8b949e;display:flex;gap:4px;align-items:center;white-space:nowrap;cursor:pointer}',
    '.sbd-row{display:grid;grid-template-columns:92px 58px 1fr 58px 52px;gap:6px;padding:3px 8px;border-bottom:1px solid #161b22;cursor:pointer;align-items:baseline}',
    '.sbd-row>span{overflow:hidden;white-space:nowrap;text-overflow:ellipsis}',
    '.sbd-row:hover{background:#161b22}',
    '.sbd-row.sbd-err{background:rgba(248,81,73,.09)}',
    '.sbd-row.sbd-sys{opacity:.55}',
    '.sbd-t{color:#6e7681}',
    '.sbd-pat{color:#e6edf3;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.sbd-dir{font-size:10px;text-transform:uppercase;letter-spacing:.04em}',
    '.sbd-dir-remote{color:#d2a8ff}',
    '.sbd-dir-local{color:#7ee787}',
    '.sbd-st{font-weight:700;text-align:right}',
    '.sbd-st-ok{color:#3fb950}',
    '.sbd-st-err{color:#f85149}',
    '.sbd-st-timeout{color:#f0b429}',
    '.sbd-dur{color:#8b949e;text-align:right}',
    '.sbd-detail{background:#010409;border-bottom:1px solid #21262d;padding:8px;overflow:auto}',
    '.sbd-detail h4{margin:0 0 4px;color:#8b949e;font-size:11px;font-weight:700}',
    '.sbd-detail pre{margin:0 0 10px;white-space:pre-wrap;word-break:break-word;color:#c9d1d9}',
    '.sbd-empty{padding:20px;text-align:center;color:#6e7681}',
    '.sbd-cfg{padding:10px}',
    '.sbd-cfg h4{margin:12px 0 4px;color:#58a6ff;font-size:12px}',
    '.sbd-cfg h4:first-child{margin-top:0}',
    '.sbd-cfg pre{margin:0;white-space:pre-wrap;word-break:break-word;color:#c9d1d9}',
    '.sbd-plug{display:inline-block;background:#161b22;border:1px solid #30363d;border-radius:10px;padding:1px 8px;margin:2px 4px 2px 0;color:#c9d1d9}',
    '.sbd-storebar{display:flex;gap:8px;align-items:center;justify-content:space-between;color:#8b949e;padding:4px 2px 10px}',
    '.sbd-gnode{color:#58a6ff;font-weight:700;margin:8px 0 2px;border-bottom:1px solid #21262d;padding-bottom:2px}',
    '.sbd-enode{margin:0 0 2px 8px}',
    '.sbd-enode-head{display:flex;justify-content:space-between;gap:8px;cursor:pointer;padding:2px 4px;border-radius:4px}',
    '.sbd-enode-head:hover{background:#161b22}',
    '.sbd-enode-key{color:#7ee787;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.sbd-enode-key.sbd-stale{color:#f0b429}',
    '.sbd-enode-meta{color:#6e7681;white-space:nowrap}',
    '.sbd-enode pre{margin:2px 0 6px 8px;background:#010409;padding:6px;border-radius:4px;white-space:pre-wrap;word-break:break-word;color:#c9d1d9}',
  ].join('\n')

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) {
      return
    }
    const el = document.createElement('style')
    el.id = STYLE_ID
    el.textContent = STYLE
    document.head.appendChild(el)
  }

  function h(tag, cls, text) {
    const el = document.createElement(tag)
    if (cls) {
      el.className = cls
    }
    if (null != text) {
      el.textContent = text
    }
    return el
  }

  function fmtTime(ms) {
    if (null == ms) {
      return ''
    }
    const d = new Date(ms)
    const p2 = function (n) {
      return (n < 10 ? '0' : '') + n
    }
    const p3 = function (n) {
      return (n < 10 ? '00' : n < 100 ? '0' : '') + n
    }
    return (
      p2(d.getHours()) +
      ':' +
      p2(d.getMinutes()) +
      ':' +
      p2(d.getSeconds()) +
      '.' +
      p3(d.getMilliseconds())
    )
  }

  function fmtDur(ms) {
    if (null == ms) {
      return ''
    }
    if (ms < 1000) {
      return ms + 'ms'
    }
    return (ms / 1000).toFixed(2) + 's'
  }

  function mountPanel(opts, api, flows, remoteKeys, storeBridge) {
    injectStyle()

    const state = {
      tab: 'messages',
      filter: '',
      hideSystem: opts.hideSystem,
      autoscroll: true,
      openSeq: null,
      visible: !!opts.open,
    }

    const root = h('div', 'sbd-root')

    // Launcher (collapsed state).
    const launch = h('div', 'sbd-launch')
    launch.appendChild(h('span', null, '🛰 Seneca'))
    const badge = h('span', 'sbd-badge', '0')
    launch.appendChild(badge)

    // Panel (expanded state).
    const panel = h('div', 'sbd-panel')
    panel.style.width = opts.width + 'px'
    panel.style.height = opts.height + 'px'

    const head = h('div', 'sbd-head')
    head.appendChild(h('span', 'sbd-title', 'Seneca'))
    const tabs = h('div', 'sbd-tabs')
    const tabMsg = h('button', 'sbd-tab sbd-on', 'Messages')
    const tabStore = h('button', 'sbd-tab', 'Store')
    const tabCfg = h('button', 'sbd-tab', 'Config')
    tabs.appendChild(tabMsg)
    tabs.appendChild(tabStore)
    tabs.appendChild(tabCfg)
    head.appendChild(tabs)
    head.appendChild(h('div', 'sbd-sp'))
    const btnPause = h('button', 'sbd-btn', 'Pause')
    const btnClear = h('button', 'sbd-btn', 'Clear')
    const btnClose = h('button', 'sbd-btn', '✕')
    head.appendChild(btnPause)
    head.appendChild(btnClear)
    head.appendChild(btnClose)
    panel.appendChild(head)

    const body = h('div', 'sbd-body')
    panel.appendChild(body)

    root.appendChild(launch)
    root.appendChild(panel)
    document.body.appendChild(root)

    // ---- rendering -------------------------------------------------------

    function visibleFlows() {
      const f = state.filter.toLowerCase()
      const out = []
      for (let i = 0; i < flows.length; i++) {
        const rec = flows[i]
        if (state.hideSystem && rec.system) {
          continue
        }
        if (f && rec.pattern.toLowerCase().indexOf(f) < 0) {
          continue
        }
        out.push(rec)
      }
      return out
    }

    function renderMessages() {
      body.innerHTML = ''

      const bar = h('div', 'sbd-bar')
      const input = h('input', 'sbd-in')
      input.placeholder = 'filter pattern…'
      input.value = state.filter
      input.oninput = function () {
        state.filter = input.value
        renderMessages()
      }
      bar.appendChild(input)

      bar.appendChild(makeCheck('system', !state.hideSystem, function (on) {
        state.hideSystem = !on
        renderMessages()
      }))
      bar.appendChild(makeCheck('follow', state.autoscroll, function (on) {
        state.autoscroll = on
      }))
      body.appendChild(bar)

      const list = h('div', 'sbd-list')
      const rows = visibleFlows()
      if (0 === rows.length) {
        list.appendChild(h('div', 'sbd-empty', 'No messages captured yet.'))
      }
      for (let i = 0; i < rows.length; i++) {
        list.appendChild(renderRow(rows[i]))
      }
      body.appendChild(list)

      if (state.autoscroll && null == state.openSeq) {
        body.scrollTop = body.scrollHeight
      }
    }

    function renderRow(rec) {
      let cls = 'sbd-row'
      if ('ok' !== rec.status) {
        cls += ' sbd-err'
      }
      if (rec.system) {
        cls += ' sbd-sys'
      }
      const row = h('div', cls)
      row.appendChild(h('span', 'sbd-t', fmtTime(rec.time)))
      row.appendChild(h('span', 'sbd-dir sbd-dir-' + rec.dir, rec.dir))
      row.appendChild(h('span', 'sbd-pat', rec.pattern || '(no pattern)'))
      row.appendChild(h('span', 'sbd-st sbd-st-' + rec.status, rec.status))
      row.appendChild(h('span', 'sbd-dur', fmtDur(rec.duration)))
      row.onclick = function () {
        state.openSeq = state.openSeq === rec.seq ? null : rec.seq
        renderMessages()
      }
      if (state.openSeq === rec.seq) {
        const wrap = h('div')
        wrap.appendChild(row)
        wrap.appendChild(renderDetail(rec))
        return wrap
      }
      return row
    }

    function renderDetail(rec) {
      const d = h('div', 'sbd-detail')
      if (rec.error) {
        d.appendChild(h('h4', null, 'error'))
        d.appendChild(h('pre', null, rec.error))
      }
      d.appendChild(h('h4', null, 'msg'))
      d.appendChild(h('pre', null, pretty(rec.msg)))
      d.appendChild(h('h4', null, 'result'))
      d.appendChild(h('pre', null, pretty(rec.result)))
      const meta = { seq: rec.seq, id: rec.id, pattern: rec.pattern, dir: rec.dir, duration: rec.duration }
      d.appendChild(h('h4', null, 'meta'))
      d.appendChild(h('pre', null, pretty(meta)))
      return d
    }

    function renderConfig() {
      body.innerHTML = ''
      const cfg = api.config()
      const box = h('div', 'sbd-cfg')

      box.appendChild(h('h4', null, 'Instance'))
      box.appendChild(h('pre', null, pretty({
        id: cfg.id,
        version: cfg.version,
        remotePins: cfg.remoteKeys,
      })))

      box.appendChild(h('h4', null, 'Plugins (' + cfg.plugins.length + ')'))
      const plugs = h('div')
      if (0 === cfg.plugins.length) {
        plugs.appendChild(h('span', 'sbd-empty', 'none'))
      }
      for (let i = 0; i < cfg.plugins.length; i++) {
        const p = cfg.plugins[i]
        plugs.appendChild(h('span', 'sbd-plug', p.name + (p.tag ? '$' + p.tag : '')))
      }
      box.appendChild(plugs)

      box.appendChild(h('h4', null, 'Options'))
      box.appendChild(h('pre', null, pretty(cfg.options)))

      body.appendChild(box)
    }

    function renderStore() {
      body.innerHTML = ''
      const box = h('div', 'sbd-cfg')
      box.appendChild(h('div', 'sbd-empty', 'Loading store…'))
      body.appendChild(box)

      storeBridge.get(function (out) {
        // Ignore a late response if the user has since switched tabs.
        if ('store' !== state.tab) {
          return
        }
        body.innerHTML = ''
        const wrap = h('div', 'sbd-cfg')

        if (!out) {
          wrap.appendChild(h('div', 'sbd-empty',
            'No store plugin loaded. Add @voxgig/seneca-browser-store to cache queries.'))
          body.appendChild(wrap)
          return
        }

        const s = out.stats || {}
        const bar = h('div', 'sbd-storebar')
        bar.appendChild(h('span', null,
          out.entries + ' entries · ' +
          (s.hits || 0) + ' hits · ' +
          (s.misses || 0) + ' misses · ' +
          (s.optimistic || 0) + ' optimistic · ' +
          (s.invalidations || 0) + ' invalidations'))
        const clr = h('button', 'sbd-btn', 'Clear')
        clr.onclick = function () {
          storeBridge.clear(function () {
            renderStore()
          })
        }
        bar.appendChild(clr)
        wrap.appendChild(bar)

        const groups = Object.keys(out.state || {}).sort()
        if (0 === groups.length) {
          wrap.appendChild(h('div', 'sbd-empty', 'Cache is empty.'))
        }
        for (let i = 0; i < groups.length; i++) {
          const gid = groups[i]
          const g = out.state[gid]
          wrap.appendChild(h('div', 'sbd-gnode',
            gid + '  (' + g.count + ')'))
          for (let j = 0; j < g.entries.length; j++) {
            wrap.appendChild(renderStoreEntry(g.entries[j]))
          }
        }
        body.appendChild(wrap)
      })
    }

    function renderStoreEntry(e) {
      const row = h('div', 'sbd-enode')
      const head = h('div', 'sbd-enode-head')
      head.appendChild(h('span', 'sbd-enode-key' + (e.stale ? ' sbd-stale' : ''),
        e.label || '(entry)'))
      head.appendChild(h('span', 'sbd-enode-meta',
        'hits ' + e.hits + ' · ' + fmtDur(e.age) + ' ago'))
      row.appendChild(head)
      let open = false
      const pre = h('pre')
      pre.style.display = 'none'
      pre.textContent = pretty(e.value)
      head.onclick = function () {
        open = !open
        pre.style.display = open ? 'block' : 'none'
      }
      row.appendChild(pre)
      return row
    }

    function render() {
      if ('config' === state.tab) {
        renderConfig()
      }
      else if ('store' === state.tab) {
        renderStore()
      }
      else {
        renderMessages()
      }
    }

    function makeCheck(label, checked, onchange) {
      const lbl = h('label', 'sbd-lbl')
      const cb = h('input')
      cb.type = 'checkbox'
      cb.checked = checked
      cb.onchange = function () {
        onchange(cb.checked)
      }
      lbl.appendChild(cb)
      lbl.appendChild(document.createTextNode(label))
      return lbl
    }

    // ---- visibility ------------------------------------------------------

    function applyVisible() {
      panel.style.display = state.visible ? 'flex' : 'none'
      launch.style.display = state.visible ? 'none' : 'flex'
      if (state.visible) {
        render()
      }
    }

    function show() {
      state.visible = true
      applyVisible()
    }
    function hide() {
      state.visible = false
      applyVisible()
    }
    function toggle() {
      state.visible = !state.visible
      applyVisible()
    }

    api.show = show
    api.hide = hide
    api.toggle = toggle

    function updateBadge() {
      badge.textContent = String(flows.length)
    }

    launch.onclick = show
    btnClose.onclick = hide

    const tabButtons = { messages: tabMsg, store: tabStore, config: tabCfg }
    function selectTab(name) {
      state.tab = name
      for (const k in tabButtons) {
        tabButtons[k].classList.toggle('sbd-on', k === name)
      }
      render()
    }
    tabMsg.onclick = function () {
      selectTab('messages')
    }
    tabStore.onclick = function () {
      selectTab('store')
    }
    tabCfg.onclick = function () {
      selectTab('config')
    }
    btnClear.onclick = function () {
      api.clear()
    }
    btnPause.onclick = function () {
      const p = api.pause()
      btnPause.textContent = p ? 'Resume' : 'Pause'
      btnPause.classList.toggle('sbd-act', p)
    }

    // ---- drag ------------------------------------------------------------

    enableDrag(panel, head)

    // ---- keyboard shortcut ----------------------------------------------

    if (opts.shortcut) {
      document.addEventListener('keydown', function (ev) {
        if (ev.ctrlKey && ('`' === ev.key || 'Backquote' === ev.code)) {
          ev.preventDefault()
          toggle()
        }
      })
    }

    // ---- live updates (throttled to animation frames) -------------------

    let pending = false
    api.subscribe(function () {
      updateBadge()
      if (!state.visible || 'messages' !== state.tab || pending) {
        return
      }
      pending = true
      const raf = typeof requestAnimationFrame === 'function'
        ? requestAnimationFrame
        : function (fn) {
            return setTimeout(fn, 16)
          }
      raf(function () {
        pending = false
        renderMessages()
      })
    })

    // Reflect any flows captured before the panel mounted (plugin init
    // registers capture synchronously; the panel mounts on ready).
    updateBadge()

    applyVisible()
  }

  function enableDrag(panel, handle) {
    let sx = 0
    let sy = 0
    let ox = 0
    let oy = 0

    function down(ev) {
      // Ignore drags that start on the header buttons.
      if ('BUTTON' === ev.target.tagName) {
        return
      }
      const rect = panel.getBoundingClientRect()
      // Switch anchoring from right/bottom to left/top so movement is stable.
      panel.style.left = rect.left + 'px'
      panel.style.top = rect.top + 'px'
      panel.style.right = 'auto'
      panel.style.bottom = 'auto'
      sx = ev.clientX
      sy = ev.clientY
      ox = rect.left
      oy = rect.top
      document.addEventListener('mousemove', move)
      document.addEventListener('mouseup', up)
      ev.preventDefault()
    }
    function move(ev) {
      const nx = Math.max(0, ox + (ev.clientX - sx))
      const ny = Math.max(0, oy + (ev.clientY - sy))
      panel.style.left = nx + 'px'
      panel.style.top = ny + 'px'
    }
    function up() {
      document.removeEventListener('mousemove', move)
      document.removeEventListener('mouseup', up)
    }
    handle.addEventListener('mousedown', down)
  }

  function pretty(v) {
    try {
      return JSON.stringify(v, null, 2)
    }
    catch (e) {
      return String(v)
    }
  }

  // Exposed for unit testing the pure capture logic without a live Seneca.
  browser_debug.internal = {
    makeRecordBuilder: makeRecordBuilder,
    normalizeRemotePins: normalizeRemotePins,
    directionOf: directionOf,
    isSystem: isSystem,
    isTimeout: isTimeout,
    sanitize: sanitize,
    stripMarkers: stripMarkers,
    patternOf: patternOf,
  }

  return browser_debug
})
