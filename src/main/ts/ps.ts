import process from 'node:process'
import fs from 'node:fs'
import os from 'node:os'
import { parse, type TIngridResponse } from '@webpod/ingrid'
import { exec, type TSpawnCtx } from 'zurk/spawn'

const noop = () => {}

const IS_WIN = process.platform === 'win32'
const IS_WIN2025_PLUS = IS_WIN && Number.parseInt(os.release().split('.')[2], 10) >= 26_000
const LOOKUP_FLOW = IS_WIN ? IS_WIN2025_PLUS ? 'pwsh' : 'wmic' : 'ps'
const LOOKUPS: Record<string, {
  cmd: string
  args: string[]
  parse: (stdout: string) => TIngridResponse
}> = {
  wmic: {
    cmd: 'wmic process get ProcessId,ParentProcessId,CommandLine',
    args: [],
    parse: (stdout) => parse(removeWmicPrefix(stdout), { format: 'win' }),
  },
  ps: {
    cmd: 'ps',
    args: ['-eo', 'pid,ppid,args'],
    parse: (stdout) => parse(stdout, { format: 'unix' }),
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
  runLookup(query, cb, false)

/** Synchronous version of {@link lookup}. */
export const lookupSync = (query: TPsLookupQuery = {}, cb: TPsLookupCallback = noop): TPsLookupEntry[] =>
  runLookup(query, cb, true)

lookup.sync = lookupSync

function runLookup(query: TPsLookupQuery, cb: TPsLookupCallback, sync: true): TPsLookupEntry[]
function runLookup(query: TPsLookupQuery, cb: TPsLookupCallback, sync: false): Promise<TPsLookupEntry[]>
function runLookup(query: TPsLookupQuery, cb: TPsLookupCallback, sync: boolean): TPsLookupEntry[] | Promise<TPsLookupEntry[]> {
  const { parse: parseOutput, cmd, args: defaultArgs } = LOOKUPS[LOOKUP_FLOW]
  const args = !IS_WIN && query.psargs ? query.psargs.split(/\s+/) : defaultArgs
  let result: TPsLookupEntry[] = []
  let error: unknown

  const handle: TSpawnCtx['callback'] = (err, { stdout }) => {
    if (err) { error = err; return }
    result = filterProcessList(normalizeOutput(parseOutput(stdout)), query)
  }

  if (sync) {
    exec({ cmd, args, sync: true, callback: handle, run(c) { c() } })
    cb(error ?? null, error ? undefined : result)
    if (error) throw error
    return result
  }

  return new Promise((resolve, reject) => {
    exec({
      cmd, args, sync: false, run(c) { c() },
      callback(err, ctx) {
        handle(err, ctx)
        if (error) { cb(error); reject(error) }
        else { cb(null, result); resolve(result) }
      },
    })
  })
}

/** Returns child processes of the given parent pid. */
export const tree = async (opts?: string | number | TPsTreeOpts, cb: TPsLookupCallback = noop): Promise<TPsLookupEntry[]> => {
  try {
    const list = pickFromTree(await lookup(), opts)
    cb(null, list)
    return list
  } catch (err) {
    cb(err)
    throw err
  }
}

/** Synchronous version of {@link tree}. */
export const treeSync = (opts?: string | number | TPsTreeOpts, cb: TPsLookupCallback = noop): TPsLookupEntry[] => {
  try {
    const list = pickFromTree(lookupSync(), opts)
    cb(null, list)
    return list
  } catch (err) {
    cb(err)
    throw err
  }
}

tree.sync = treeSync

const pickFromTree = (all: TPsLookupEntry[], opts?: string | number | TPsTreeOpts): TPsLookupEntry[] => {
  if (opts === undefined) return all
  const { pid, recursive = false } = typeof opts === 'object' ? opts : { pid: opts }
  return pickTree(all, pid, recursive)
}

export const pickTree = (list: TPsLookupEntry[], pid: string | number, recursive = false): TPsLookupEntry[] => {
  const children = list.filter(p => p.ppid === String(pid))
  return recursive
    ? children.flatMap(p => [p, ...pickTree(list, p.pid, true)])
    : children
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

  const { timeout = 30, signal = 'SIGTERM', interval = 200 } = opts || {}
  const sPid = String(pid)

  return new Promise<any>((resolve, reject) => {
    let done = false
    const entry: TKillEntry = { pid: sPid, registered: 0, interval, settle: noop }
    const settle = (err?: unknown) => {
      if (done) return
      done = true
      clearTimeout(timer)
      killPending.delete(entry)
      if (err) reject(err)
      else resolve(pid)
      next?.(err ?? null, pid)
    }
    entry.settle = settle

    const timer = setTimeout(() => settle(new Error('Kill process timeout')), timeout * 1000)

    try {
      process.kill(+pid, signal)
    } catch (e) {
      settle(e)
      return
    }

    entry.registered = Date.now()
    killPending.add(entry)
    scheduleKillTick()
  })
}

/**
 * Shared kill-confirmation loop. A single `lookup()` per tick serves *all* pending kills
 * registered before the tick's snapshot started — so a flood of kills can never indefinitely
 * postpone any single confirmation, and we never spawn more than one `ps` per tick.
 */
type TKillEntry = { pid: string, registered: number, interval: number, settle: (err?: unknown) => void }
const killPending = new Set<TKillEntry>()
let killTickTimer: NodeJS.Timeout | null = null
let killTickRunning = false

const scheduleKillTick = (lastStart = 0): void => {
  if (killTickTimer || killTickRunning || killPending.size === 0) return
  let minInterval = Infinity
  for (const k of killPending) if (k.interval < minInterval) minInterval = k.interval
  const delay = lastStart === 0 ? 0 : Math.max(0, lastStart + minInterval - Date.now())
  killTickTimer = setTimeout(runKillTick, delay)
}

const runKillTick = (): void => {
  killTickTimer = null
  if (killPending.size === 0) return
  killTickRunning = true
  const startedAt = Date.now()
  lookup().then(list => {
    const alive = new Set(list.map(p => p.pid))
    for (const k of killPending) {
      // Snapshot predates this kill's process.kill — can't trust it, wait for next tick
      if (k.registered >= startedAt) continue
      if (!alive.has(k.pid)) k.settle()
    }
    killTickRunning = false
    scheduleKillTick(startedAt)
  }, err => {
    for (const k of killPending) k.settle(err)
    killTickRunning = false
  })
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
