import process from 'node:process'
import fs from 'node:fs'
import os from 'node:os'
import { parse, type TIngridResponse } from '@webpod/ingrid'
import { exec, type TSpawnCtx } from 'zurk/spawn'

const IS_WIN = process.platform === 'win32'
const IS_WIN2025_PLUS = IS_WIN && Number.parseInt(os.release().split('.')[2], 10) >= 26_000
const LOOKUPS: Record<string, {
  cmd: string,
  args?: string[],
  parse: (stdout: string) => TIngridResponse
}> = {
  wmic: {
    cmd: 'wmic process get ProcessId,ParentProcessId,CommandLine',
    args: [],
    parse: (stdout) => parse(removeWmicPrefix(stdout), { format: 'win' })
  },
  ps: {
    cmd: 'ps',
    args: ['-eo', 'pid,ppid,args'],
    parse: (stdout) => parse(stdout, { format: 'unix' })
  },
  pwsh: {
    cmd: 'pwsh',
    args: ['-NoProfile', '-Command', '"Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,CommandLine | ConvertTo-Json -Compress"'],
    parse(stdout) {
      try {
        const arr: Array<{ ProcessId: number, ParentProcessId: number, CommandLine: string | null }> = JSON.parse(stdout)
        return arr.map(p => ({
          ProcessId: [String(p.ProcessId)],
          ParentProcessId: [String(p.ParentProcessId)],
          CommandLine: p.CommandLine ? [p.CommandLine] : [],
        }))
      } catch {
        return []
      }
    },
  },
}

const lookupFlow = IS_WIN ? IS_WIN2025_PLUS ? 'pwsh' : 'wmic' : 'ps'

export type TPsLookupEntry = {
  pid: string
  ppid?: string
  command: string
  arguments: string[]
}

export type TPsLookupQuery = {
  pid?: number | string | (string | number)[]
  command?: string
  arguments?: string
  ppid?: number | string
  psargs?: string
}

export type TPsLookupCallback = (err: any, processList?: TPsLookupEntry[]) => void

export type TPsKillOptions = {
  timeout?: number
  signal?: string | number | NodeJS.Signals
  /** Polling interval in ms between exit checks (default 200). */
  interval?: number
}

export type TPsTreeOpts = {
  pid: string | number
  recursive?: boolean
}

export type TPsNext = (err?: any, data?: any) => void

/**
 * Query running processes by pid, command, arguments or ppid.
 * Supports both promise and callback styles.
 */
export const lookup = (query: TPsLookupQuery = {}, cb: TPsLookupCallback = noop): Promise<TPsLookupEntry[]> =>
  _lookup({ query, cb, sync: false }) as Promise<TPsLookupEntry[]>

/** Synchronous version of {@link lookup}. */
export const lookupSync = (query: TPsLookupQuery = {}, cb: TPsLookupCallback = noop): TPsLookupEntry[] =>
  _lookup({ query, cb, sync: true })

lookup.sync = lookupSync

const _lookup = ({ query = {}, cb = noop, sync = false }: {
  sync?: boolean
  cb?: TPsLookupCallback
  query?: TPsLookupQuery
}) => {
  const { promise, resolve, reject } = sync ? makeSyncDeferred<TPsLookupEntry[]>([]) : makeDeferred<TPsLookupEntry[]>()
  const result: TPsLookupEntry[] = []
  const { parse: parseOutput, cmd, args: defaultArgs } = LOOKUPS[lookupFlow]
  const args = !IS_WIN && query.psargs ? query.psargs.split(/\s+/) : defaultArgs

  const callback: TSpawnCtx['callback'] = (err, { stdout }) => {
    if (err) {
      reject(err)
      cb(err)
      return
    }
    result.push(...filterProcessList(normalizeOutput(parseOutput(stdout)), query))
    resolve(result)
    cb(null, result)
  }

  exec({ cmd, args, callback, sync, run(cb) { cb() } })

  return Object.assign(promise, result)
}

/** Returns child processes of the given parent pid. */
export const tree = async (opts?: string | number | TPsTreeOpts, cb?: TPsLookupCallback): Promise<TPsLookupEntry[]> =>
  _tree({ opts, cb })

/** Synchronous version of {@link tree}. */
export const treeSync = (opts?: string | number | TPsTreeOpts, cb?: TPsLookupCallback): TPsLookupEntry[] =>
  _tree({ opts, cb, sync: true }) as TPsLookupEntry[]

tree.sync = treeSync

const _tree = ({ cb = noop, opts, sync = false }: {
  opts?: string | number | TPsTreeOpts
  cb?: TPsLookupCallback
  sync?: boolean
}) => {
  if (typeof opts === 'string' || typeof opts === 'number') {
    return _tree({ opts: { pid: opts }, cb, sync })
  }

  const onData = (all: TPsLookupEntry[]) => {
    if (opts === undefined) return all
    const list = pickTree(all, opts.pid, opts.recursive ?? false)
    cb(null, list)
    return list
  }

  const onError = (err: unknown) => {
    cb(err)
    throw err
  }

  try {
    const all = _lookup({ sync })
    return sync
      ? onData(all)
      : (all as Promise<TPsLookupEntry[]>).then(onData, onError)
  } catch (err) {
    cb(err)
    return Promise.reject(err)
  }
}

/**
 * Returns a `lookup()` snapshot started at or after `since`, dedupes concurrent callers.
 * Lets parallel `kill()` polls share a single `ps` invocation: join the in-flight one
 * if it's fresh enough, otherwise wait for the next queued one.
 */
type TSnapshot = { startedAt: number, list: TPsLookupEntry[] }
let inflight: { startedAt: number, promise: Promise<TSnapshot> } | null = null
let queued: Promise<TSnapshot> | null = null
const sharedSnapshot = (since: number): Promise<TSnapshot> => {
  if (inflight && inflight.startedAt >= since) return inflight.promise
  if (queued) return queued
  const after = inflight?.promise.catch(noop) ?? Promise.resolve()
  return queued = after.then(() => {
    queued = null
    const startedAt = Date.now()
    const promise = lookup().then(list => ({ startedAt, list }))
    inflight = { startedAt, promise }
    return promise.finally(() => { inflight = inflight?.promise === promise ? null : inflight })
  })
}

export const pickTree = (list: TPsLookupEntry[], pid: string | number, recursive = false): TPsLookupEntry[] => {
  const children = list.filter(p => p.ppid === String(pid))
  return [
    ...children,
    ...children.flatMap(p => recursive ? pickTree(list, p.pid, true) : [])
  ]
}

/**
 * Kills a process by pid.
 * @param pid - Process ID to kill
 * @param opts - Signal, options object, or callback
 * @param next - Callback invoked when kill is confirmed or timed out
 */
export const kill = (pid: string | number, opts?: TPsNext | TPsKillOptions | TPsKillOptions['signal'], next?: TPsNext): Promise<void> => {
  if (typeof opts === 'function') return kill(pid, undefined, opts)
  if (typeof opts === 'string' || typeof opts === 'number') return kill(pid, { signal: opts }, next)

  const { promise, resolve, reject } = makeDeferred()
  const { timeout = 30, signal = 'SIGTERM', interval = 200 } = opts || {}
  const sPid = String(pid)
  let done = false
  const settle = (err?: unknown) => {
    if (done) return
    done = true
    clearTimeout(timer)
    err ? reject(err) : resolve(pid)
    next?.(err ?? null, pid)
  }

  let timer: NodeJS.Timeout
  try {
    process.kill(+pid, signal)
  } catch (e) {
    settle(e)
    return promise
  }

  let since = Date.now()
  timer = setTimeout(() => settle(new Error('Kill process timeout')), timeout * 1000)

  const poll = (): unknown =>
    sharedSnapshot(since).then(({ startedAt, list }) => {
      if (done) return
      since = startedAt + 1
      if (list.some(p => p.pid === sPid)) {
        setTimeout(poll, Math.max(0, startedAt + interval - Date.now()))
      } else {
        settle()
      }
    }, settle)

  poll()
  return promise
}

export const normalizeOutput = (data: TIngridResponse): TPsLookupEntry[] =>
  data.flatMap(d => {
    const pid = (d.PID || d.ProcessId)?.[0]
    const ppid = (d.PPID || d.ParentProcessId)?.[0]
    const rawCmd = d.CMD || d.CommandLine || d.COMMAND || d.ARGS || []
    const parts = rawCmd.length === 1 ? rawCmd[0].split(/\s+/) : rawCmd

    if (!pid || parts.length === 0) return []

    const binIdx = parts.findIndex((_v, i) => isBin(parts.slice(0, i).join(' ')))
    const command = (binIdx === -1 ? parts : parts.slice(0, binIdx)).join(' ')
    const args = binIdx === -1 ? [] : parts.slice(binIdx)

    return [{ pid, ppid, command, arguments: args }]
  })

export const filterProcessList = (processList: TPsLookupEntry[], query: TPsLookupQuery = {}): TPsLookupEntry[] => {
  const pidList = (query.pid === undefined ? [] : [query.pid].flat(1)).map(String)
  const commandRe = query.command ? new RegExp(query.command, 'i') : null
  const argumentsRe = query.arguments ? new RegExp(query.arguments, 'i') : null
  const ppid = query.ppid === undefined ? null : String(query.ppid)

  return processList.filter(p =>
    (pidList.length === 0 || pidList.includes(p.pid)) &&
    (!commandRe || commandRe.test(p.command)) &&
    (!argumentsRe || argumentsRe.test(p.arguments.join(' '))) &&
    (!ppid || ppid === p.ppid)
  )
}

export const removeWmicPrefix = (stdout: string): string => {
  const s = stdout.indexOf(LOOKUPS.wmic.cmd + os.EOL)
  const e = stdout.includes('>')
    ? stdout.trimEnd().lastIndexOf(os.EOL)
    : stdout.length
  return (s > 0
    ? stdout.slice(s + LOOKUPS.wmic.cmd.length, e)
    : stdout.slice(0, e)).trimStart()
}

const isBin = (f: string): boolean => {
  if (f === '') return false
  if (!f.includes('/') && !f.includes('\\')) return true
  if (f.length > 3 && f[0] === '"')
    return f.at(-1) === '"' ? isBin(f.slice(1, -1)) : false
  try {
    if (!fs.existsSync(f)) return false
    const stat = fs.lstatSync(f)
    return stat.isFile() || stat.isSymbolicLink()
  } catch {
    return false
  }
}

type Deferred<T = any, E = any> = {
  promise: Promise<T>
  resolve: (value?: T | PromiseLike<T>) => void
  reject: (reason?: E) => void
}

const makeDeferred = <T = any, E = any>(): Deferred<T, E> => {
  let resolve!: Deferred<T, E>['resolve']
  let reject!: Deferred<T, E>['reject']
  const promise = new Promise<T>((res, rej) => { resolve = res as Deferred<T, E>['resolve']; reject = rej })
  return { resolve, reject, promise }
}

const makeSyncDeferred = <T = any>(result: T): Deferred<T> => ({
  promise: result as any,
  resolve: () => {},
  reject(e) { throw e },
})

const noop = () => {}
