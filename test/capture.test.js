/* Headless tests for the capture engine (no DOM required).
 * The in-window panel is guarded by `typeof document`, so with ui:false
 * the plugin runs cleanly under Node and we can assert on captured flows.
 */

const { test } = require('node:test')
const assert = require('node:assert')

// Prefer an installed @seneca/browser; fall back to the sibling checkout.
let Seneca
try {
  Seneca = require('@seneca/browser')
}
catch (e) {
  Seneca = require('../../seneca-browser/seneca-browser.js')
}

const BrowserDebug = require('../browser-debug.js')

function make() {
  return Seneca({ legacy: false, log: 'silent' })
}

test('captures ok and remote flows from a live bus', async function () {
  const seneca = make()
  seneca.use(BrowserDebug, { ui: false, remotePins: 'aim:*', hideSystem: true })

  seneca.add('a:1', function (m, r) {
    r(null, { x: (m.x || 0) + 1 })
  })
  seneca.add('aim:remote', function (m, r) {
    r(null, { pong: true })
  })

  await new Promise(function (done) {
    seneca.ready(done)
  })

  await seneca.post('a:1,x:5')
  await seneca.post('aim:remote')
  await new Promise(function (r) {
    setTimeout(r, 50)
  })

  const api = seneca.export('browser-debug/api')
  const flows = api.flows()

  const a = flows.find(function (f) {
    return 'a:1' === f.pattern
  })
  assert.ok(a, 'a:1 captured')
  assert.equal(a.status, 'ok')
  assert.equal(a.dir, 'local')
  assert.equal(a.result.x, 6)
  assert.equal(typeof a.duration, 'number')

  const rem = flows.find(function (f) {
    return 'aim:remote' === f.pattern
  })
  assert.ok(rem, 'aim:remote captured')
  assert.equal(rem.dir, 'remote', 'remotePins classifies aim:* as remote')
})

test('captures an error flow from a live bus', async function () {
  const seneca = make()
  seneca.use(BrowserDebug, { ui: false })

  seneca.add('b:1', function (m, r) {
    r(new Error('boom'))
  })

  await new Promise(function (done) {
    seneca.ready(done)
  })

  await new Promise(function (r) {
    seneca.act('b:1', function () {
      r()
    })
  })
  await new Promise(function (r) {
    setTimeout(r, 50)
  })

  const api = seneca.export('browser-debug/api')
  const b = api.flows().find(function (f) {
    return 'b:1' === f.pattern && 'err' === f.status
  })
  assert.ok(b, 'b:1 error flow captured')
  assert.equal(b.status, 'err')
  assert.ok(b.error, 'error text present')
})

// error/timeout status is also unit-tested below via the pure record
// builder (independent of a live bus).
test('record builder classifies ok / err / timeout and direction', function () {
  const build = BrowserDebug.internal.makeRecordBuilder(['aim'])

  const ok = build({ a: 1, x: 5 }, { x: 6 }, {
    pattern: 'a:1', id: 'i1', start: 100, end: 103,
  })
  assert.equal(ok.status, 'ok')
  assert.equal(ok.dir, 'local')
  assert.equal(ok.duration, 3)
  assert.equal(ok.error, null)
  assert.equal(ok.seq, 1)

  const err = build({ b: 1 }, new Error('boom'), {
    pattern: 'b:1', error: true, start: 200, end: 205,
  })
  assert.equal(err.status, 'err')
  assert.equal(err.error, 'boom')
  assert.equal(err.seq, 2, 'seq increments across calls')

  const timeout = build({ c: 1 }, { code: 'action_timeout', message: 'x' }, {
    pattern: 'c:1', error: true, start: 0, end: 8888,
  })
  assert.equal(timeout.status, 'timeout')

  const remote = build({ aim: 'req', do: 'thing' }, { ok: true }, {
    pattern: 'aim:req,do:thing', start: 1, end: 2,
  })
  assert.equal(remote.dir, 'remote')
})

test('pure helpers: normalizeRemotePins / isSystem / sanitize / stripMarkers', function () {
  const I = BrowserDebug.internal

  assert.deepEqual(I.normalizeRemotePins('aim:*'), ['aim'])
  assert.deepEqual(I.normalizeRemotePins('aim:*,foo:bar'), ['aim', 'foo'])
  assert.deepEqual(I.normalizeRemotePins(['x', 'y']), ['x', 'y'])
  assert.deepEqual(I.normalizeRemotePins(null), [])

  assert.equal(I.isSystem('role:seneca,stats:true'), true)
  assert.equal(I.isSystem('plugin:define,role:seneca'), true)
  assert.equal(I.isSystem('aim:req,save:item'), false)

  // Markers ($-suffixed) are stripped from the displayed message copy.
  assert.deepEqual(I.stripMarkers({ a: 1, in$: true, meta$: {}, x: 2 }), { a: 1, x: 2 })

  // Sanitize breaks cycles, drops functions, caps strings.
  const cyc = { a: 1, fn: function () {} }
  cyc.self = cyc
  const s = I.sanitize(cyc)
  assert.equal(s.a, 1)
  assert.equal(s.fn, '[Function]')
  assert.equal(s.self, '[Circular]')
})

test('system flagging and get:flows / get:config actions', async function () {
  const seneca = make()
  seneca.use(BrowserDebug, { ui: false })

  seneca.add('a:1', function (m, r) {
    r(null, { ok: true })
  })

  await new Promise(function (done) {
    seneca.ready(done)
  })
  await seneca.post('a:1')
  await new Promise(function (r) {
    setTimeout(r, 30)
  })

  const flowsOut = await seneca.post('sys:browser-debug,get:flows')
  assert.ok(flowsOut.ok)
  assert.ok(flowsOut.flows.length > 0)
  // Internal framework messages must be flagged as system.
  assert.ok(
    flowsOut.flows.some(function (f) {
      return f.system
    }),
    'at least one system flow flagged',
  )
  assert.ok(
    flowsOut.flows.some(function (f) {
      return 'a:1' === f.pattern && !f.system
    }),
    'user flow not flagged system',
  )

  const cfgOut = await seneca.post('sys:browser-debug,get:config')
  assert.ok(cfgOut.ok)
  assert.ok(Array.isArray(cfgOut.config.plugins))
  assert.ok(
    cfgOut.config.plugins.some(function (p) {
      return 'browser-debug' === p.name
    }),
    'browser-debug listed in plugins',
  )
  assert.ok(cfgOut.config.options, 'options snapshot present')
})

test('clear:flows empties the buffer; pause stops capture', async function () {
  const seneca = make()
  seneca.use(BrowserDebug, { ui: false })
  seneca.add('a:1', function (m, r) {
    r(null, {})
  })

  await new Promise(function (done) {
    seneca.ready(done)
  })

  const api = seneca.export('browser-debug/api')

  await seneca.post('a:1')
  await new Promise(function (r) {
    setTimeout(r, 20)
  })
  assert.ok(api.flows().length > 0)

  await seneca.post('sys:browser-debug,clear:flows')
  assert.equal(api.flows().length, 0)

  api.pause(true)
  await seneca.post('a:1')
  await new Promise(function (r) {
    setTimeout(r, 20)
  })
  assert.equal(api.flows().length, 0, 'no capture while paused')

  api.pause(false)
  await seneca.post('a:1')
  await new Promise(function (r) {
    setTimeout(r, 20)
  })
  assert.ok(api.flows().length > 0, 'capture resumes')
})
