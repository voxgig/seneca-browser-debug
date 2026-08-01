// Type declarations for @voxgig/seneca-browser-debug.

export interface BrowserDebugOptions {
  /** Max number of captured flows kept in the ring buffer. Default 500. */
  limit?: number
  /** Mount the in-window panel. Set false for headless capture only. Default true. */
  ui?: boolean
  /** Start with the panel open vs. collapsed to the launcher. Default false. */
  open?: boolean
  /** Hide internal Seneca framework messages by default. Default true. */
  hideSystem?: boolean
  /**
   * Which top-level message keys indicate a remote (backend) call, so flows
   * are tagged local/remote. Accepts 'aim:*', 'aim:*,foo:*' or ['aim'].
   */
  remotePins?: string | string[] | null
  /** Ctrl+backtick toggles the panel. Default true. */
  shortcut?: boolean
  /** Initial panel width in px. Default 480. */
  width?: number
  /** Initial panel height in px. Default 360. */
  height?: number
}

export interface FlowRecord {
  seq: number
  time: number | undefined
  pattern: string
  id: string | null
  dir: 'local' | 'remote'
  status: 'ok' | 'err' | 'timeout'
  duration: number | null
  system: boolean
  msg: any
  result: any
  error: string | null
}

export interface BrowserDebugApi {
  /** Snapshot copy of the current flow buffer. */
  flows(): FlowRecord[]
  /** Empty the flow buffer. */
  clear(): void
  /** Current config snapshot (Seneca options + loaded plugins). */
  config(): {
    id: string
    version: string
    start: number
    options: any
    plugins: Array<{ name: string; tag: string | null; fullname: string }>
    remoteKeys: string[]
  }
  /** Pause/resume capture. With no argument, toggles. Returns new paused state. */
  pause(paused?: boolean): boolean
  isPaused(): boolean
  /** Subscribe to buffer changes; returns an unsubscribe function. */
  subscribe(fn: () => void): () => void
  /** Show / hide / toggle the in-window panel. */
  show(): void
  hide(): void
  toggle(): void
}

/** The Seneca plugin. Register with `seneca.use(BrowserDebug, opts)`. */
declare function browser_debug(options?: BrowserDebugOptions): any

export default browser_debug
