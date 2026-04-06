import process from 'node:process'
import fs from 'node:fs'
import os from 'node:os'
import { parse, type TIngridResponse } from '@webpod/ingrid'
import { exec, type TSpawnCtx } from 'zurk/spawn'

const IS_WIN = process.platform === 'win32'
const IS_WIN2025_PLUS = IS_WIN && Number.parseInt(os.release().split('.')[2], 10) >= 26_000 // WMIC will be missing in Windows 11 25H2 (kernel >= 26000)
const LOOKUPS: Record<string, {
  cmd: string,
  args?: string[],
  parse: (stdout: string) => TIngridResponse
}> = {
  wmic: {
    cmd: 'wmic process get ProcessId,ParentProcessId,CommandLine',
    args: [],
    parse(stdout: string) {
      return parse(removeWmicPrefix(stdout), { format: 'win' })
    }
  },
  ps: {
    cmd: 'ps',
    args: ['-eo', 'pid,ppid,args'],
    parse(stdout: string) {
      return parse(stdout, { format: 'unix' })
    }
  },
  pwsh: {
    cmd: 'pwsh',
    args: ['-NoProfile', '-Command', '"Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,CommandLine | ConvertTo-Json -Compress"'],
    parse(stdout: string) {
      let arr: any[] = []
      try {
        arr = JSON.parse(stdout)
      } catch {
        return []
      }

      // Reshape into Ingrid-like objects for normalizeOutput
      return arr.map(p => ({
        ProcessId: [p.ProcessId + ''],
        ParentProcessId: [p.ParentProcessId + ''],
        CommandLine: p.CommandLine ? [p.CommandLine] : [],
      }))
    },
  },
}

const isBin = (f: string): boolean => {
  if (f === '') return false
  if (!f.includes('/') && !f.includes('\\')) return true
  if (f.length > 3 && f[0] === '"')
    return f[f.length - 1] === '"'
      ? isBin(f.slice(1, -1))
      : false
  try {
    if (!fs.existsSync(f)) return false
    const stat = fs.lstatSync(f)
    return stat.isFile() || stat.isSymbolicLink()
  } catch {
    return false
  }
}

export type TPsLookupCallback = (err: any, processList?: TPsLookupEntry[]) => void

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
}

export type TPsKillOptions = {
  timeout?: number
  signal?: string | number | NodeJS.Signals
}

export type TPsNext = (err?: any, data?: any) => void

/**
 * Query Process: Focus on pid & cmd
 * @param query
 * @param {String|String[]} query.pid
 * @param {String} query.command RegExp String
 * @param {String} query.arguments RegExp String
 * @param {String|String[]} query.psargs
 * @param {TPsLookupCallback} cb
 * @return {Promise<TPsLookupEntry[]>}
 */
export const lookup = (query: TPsLookupQuery = {}, cb: TPsLookupCallback = noop): Promise<TPsLookupEntry[]> =>
  _lookup({query, cb, sync: false}) as Promise<TPsLookupEntry[]>

/**
 * Looks up the process list synchronously
 * @param query
 * @param {String|String[]} query.pid
 * @param {String} query.command RegExp String
 * @param {String} query.arguments RegExp String
 * @param {String|String[]} query.psargs
 * @param {TPsLookupCallback} cb
 * @return {TPsLookupEntry[]}
 */
export const lookupSync = (query: TPsLookupQuery = {}, cb: TPsLookupCallback = noop): TPsLookupEntry[] =>
  _lookup({query, cb, sync: true})

lookup.sync = lookupSync

const _lookup = ({
    query = {},
    cb = noop,
    sync = false
  }: {
    sync?: boolean
    cb?: TPsLookupCallback
    query?: TPsLookupQuery
  }) => {
  const pFactory = sync ? makePseudoDeferred.bind(null, []) : makeDeferred
  const { promise, resolve, reject } = pFactory()
  const result: TPsLookupEntry[] = []
  const lookupFlow = IS_WIN ? IS_WIN2025_PLUS ? 'pwsh' : 'wmic' : 'ps'
  const { parse, cmd, args } = LOOKUPS[lookupFlow]
  const callback: TSpawnCtx['callback'] = (err, {stdout}) => {
    if (err) {
      reject(err)
      cb(err)
      return
    }
    result.push(...filterProcessList(normalizeOutput(parse(stdout)), query))
    resolve(result)
    cb(null, result)
  }

  exec({
    cmd,
    args,
    callback,
    sync,
    run(cb) { cb() },
  })

  return Object.assign(promise, result)
}

export const filterProcessList = (processList: TPsLookupEntry[], query: TPsLookupQuery = {}): TPsLookupEntry[] => {
  const pidList= (query.pid === undefined ? [] : [query.pid].flat(1)).map(v => v + '')
  const filters: Array<(p: TPsLookupEntry) => boolean> = [
    p => query.command ? new RegExp(query.command, 'i').test(p.command) : true,
    p => query.arguments ? new RegExp(query.arguments, 'i').test(p.arguments.join(' ')) : true,
    p => query.ppid ? query.ppid + '' === p.ppid : true
  ]

  return processList.filter(p =>
    (pidList.length === 0 || pidList.includes(p.pid)) && filters.every(f => f(p))
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

export type TPsTreeOpts = {
  pid: string | number
  recursive?: boolean
}

export const pickTree = (list: TPsLookupEntry[], pid: string | number, recursive = false): TPsLookupEntry[] => {
  const children = list.filter(p => p.ppid === pid + '')
  return [
    ...children,
    ...children.flatMap(p => recursive ? pickTree(list, p.pid, true) : [])
  ]
}

const _tree = ({
  cb = noop,
  opts,
  sync = false
}: {
  opts?: string | number | TPsTreeOpts | undefined
  cb?: TPsLookupCallback
  sync?: boolean
}) => {
  if (typeof opts === 'string' || typeof opts === 'number') {
    return _tree({opts: {pid: opts}, cb, sync})
  }
  const onError = (err: any) => cb(err)
  const onData = (all: TPsLookupEntry[]) => {
    if (opts === undefined) return all

    const {pid, recursive = false} = opts
    const list = pickTree(all, pid, recursive)

    cb(null, list)
    return list
  }

  try {
    const all = _lookup({sync})
    return sync
      ? onData(all)
      : (all as Promise<TPsLookupEntry[]>).then(onData, (err: any) => {
        onError(err)
        throw err
      })
  } catch (err) {
    onError(err)
    return Promise.reject(err)
  }
}

export const tree = async (opts?: string | number | TPsTreeOpts | undefined, cb?: TPsLookupCallback): Promise<TPsLookupEntry[]> =>
  _tree({opts, cb})

export const treeSync = (opts?: string | number | TPsTreeOpts | undefined, cb?: TPsLookupCallback): TPsLookupEntry[] =>
  _tree({opts, cb, sync: true}) as TPsLookupEntry[]

tree.sync = treeSync

/**
 * Kill process
 * @param pid
 * @param {Object|String} opts
 * @param {String} opts.signal
 * @param {number} opts.timeout
 * @param next
 */
export const kill = (pid: string | number, opts?: TPsNext | TPsKillOptions | TPsKillOptions['signal'], next?: TPsNext ): Promise<void> => {
  if (typeof opts == 'function') {
    return kill(pid, undefined, opts)
  }
  if (typeof opts == 'string' || typeof opts == 'number') {
    return kill(pid, { signal: opts }, next)
  }

  const { promise, resolve, reject } = makeDeferred()
  const {
    timeout = 30,
    signal = 'SIGTERM'
  } = opts || {}

  try {
    process.kill(+pid, signal)
  } catch(e) {
    reject(e)
    next?.(e)

    return promise
  }

  let checkConfident = 0
  let checkTimeoutTimer: NodeJS.Timeout
  let checkIsTimeout = false

  const checkKilled = (finishCallback?: TPsNext) =>
    lookup({ pid }, (err, list = []) => {
      if (checkIsTimeout) return

      if (err) {
        clearTimeout(checkTimeoutTimer)
        reject(err)
        finishCallback?.(err, pid)
      }

      else if (list.length > 0) {
        checkConfident = (checkConfident - 1) || 0
        checkKilled(finishCallback)
      }

      else {
        checkConfident++
        if (checkConfident === 5) {
          clearTimeout(checkTimeoutTimer)
          resolve(pid)
          finishCallback?.(null, pid)
        } else {
          checkKilled(finishCallback)
        }
      }
    })

  if (next) {
    checkKilled(next)
    checkTimeoutTimer = setTimeout(() => {
      checkIsTimeout = true
      next(new Error('Kill process timeout'))
    }, timeout * 1000)
  } else {
    resolve(pid)
  }

  return promise
}

export const normalizeOutput = (data: TIngridResponse): TPsLookupEntry[] =>
  data.reduce<TPsLookupEntry[]>((m, d) => {
    const pid = (d.PID || d.ProcessId)?.[0]
    const ppid = (d.PPID || d.ParentProcessId)?.[0]
    const _cmd = d.CMD || d.CommandLine || d.COMMAND || d.ARGS || []
    const cmd = _cmd.length === 1 ? _cmd[0].split(/\s+/) : _cmd

    if (pid && cmd.length > 0) {
      const c = (cmd.findIndex((_v, i) => isBin(cmd.slice(0, i).join(' '))))
      const command = (c === -1 ? cmd: cmd.slice(0, c)).join(' ')
      const args = c === -1 ? [] : cmd.slice(c)

      m.push({
        pid,
        ppid,
        command: command,
        arguments: args
      })
    }

    return m
  }, [])

export type PromiseResolve<T = any> = (value?: T | PromiseLike<T>) => void

type Deferred<T, E> = { promise: Promise<T>, resolve: PromiseResolve<T>, reject: PromiseResolve<E> }

const makeDeferred = <T = any, E = any>(): Deferred<T, E> => {
  let resolve
  let reject
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { resolve, reject, promise } as unknown as Deferred<T, E>
}

const makePseudoDeferred = <T = any, E = any>(r = {}): Deferred<T, E>=>
  ({
    promise: r as any,
    resolve: identity,
    reject(e: any) {
      throw e
    }
  }) as Deferred<T, E>

const noop = () => {/* noop */}

const identity = <T>(v: T): T => v
