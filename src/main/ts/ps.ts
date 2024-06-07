import process from 'node:process'
import fs from 'node:fs'
import { EOL as SystemEOL } from 'node:os'
import { parse, TIngridResponse } from '@webpod/ingrid'
import { exec, TSpawnCtx } from 'zurk/spawn'

const EOL = /(\r\n)|(\n\r)|\n|\r/
const IS_WIN = process.platform === 'win32'
const isBin = (f: string): boolean => {
  if (f === '') return false
  if (!f.includes('/')) return true
  if (!fs.existsSync(f)) return false

  const stat = fs.lstatSync(f)
  return stat.isFile() || stat.isSymbolicLink()
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
  psargs?: string | string[]
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
 * @param {Function} [cb]
 * @param {Object=null} cb.err
 * @param {TPsLookupEntry[]} cb.processList
 * @return {Promise<TPsLookupEntry[]>}
 */
export const lookup = (query: TPsLookupQuery = {}, cb: TPsLookupCallback = noop): Promise<TPsLookupEntry[]> =>
  _lookup({query, cb, sync: false})

/**
 * Looks up the process list synchronously
 * @param query
 * @param {String|String[]} query.pid
 * @param {String} query.command RegExp String
 * @param {String} query.arguments RegExp String
 * @param {String|String[]} query.psargs
 * @param {Function} [cb]
 * @param {Object=null} cb.err
 * @param {Object[]} cb.processList
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
  const { psargs = ['-lx'] } = query // add 'lx' as default ps arguments, since the default ps output in linux like "ubuntu", wont include command arguments
  const args = Array.isArray(psargs) ? psargs : psargs.split(/\s+/)
  const extract = IS_WIN ? extractWmic : identity

  let result: TPsLookupEntry[] = []
  const callback: TSpawnCtx['callback'] = (err, {stdout}) => {
    if (err) {
      reject(err)
      cb(err)
      return
    }
    result = parseProcessList(extract(stdout), query)
    resolve(result)
    cb(null, result)
  }
  const ctx: TSpawnCtx = IS_WIN
    ? {
      cmd: 'cmd',
      input: 'wmic process get ProcessId,ParentProcessId,CommandLine \n',
      callback,
      sync,
      run(cb) {cb()}
    }
    : {
      cmd: 'ps',
      args,
      run(cb) {cb()},
      sync,
      callback,
    }

  exec(ctx)

  return Object.assign(promise, result)
}

export const parseProcessList = (output: string, query: TPsLookupQuery = {}) => {
  type TFilterKeys = keyof Pick<TPsLookupQuery, 'command' | 'arguments'| 'ppid'>

  const processList = parseGrid(output.trim())
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

export const extractWmic = (stdout: string): string => {
  const _stdout = stdout.split(EOL)
  // Find the line index for the titles
  const beginRow = _stdout.findIndex(out => out?.indexOf('CommandLine') === 0)

  // get rid of the start (copyright) and the end (current pwd)
  // eslint-disable-next-line unicorn/prefer-negative-index
  _stdout.splice(_stdout.length - 1, 1)
  _stdout.splice(0, beginRow)

  return _stdout.join(SystemEOL)
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
}): any => {
  if (typeof opts === 'string' || typeof opts === 'number') {
    return _tree({opts: {pid: opts}, cb, sync})
  }
  const handle = (all: TPsLookupEntry[]) => {
    if (opts === undefined) return all

    const {pid, recursive = false} = opts
    const list = pickTree(all, pid, recursive)

    cb(null, list)
    return list
  }

  try {
    const all = _lookup({sync})
    return sync ? handle(all) : all.then(handle)
  } catch (err) {
    cb(err)
    throw err
  }
}

export const tree = async (opts?: string | number | TPsTreeOpts | undefined, cb?: TPsLookupCallback): Promise<TPsLookupEntry[]> =>
  _tree({opts, cb})

export const treeSync = (opts?: string | number | TPsTreeOpts | undefined, cb?: TPsLookupCallback): TPsLookupEntry[] =>
  _tree({opts, cb, sync: true})

tree.sync = treeSync

/**
 * Kill process
 * @param pid
 * @param {Object|String} opts
 * @param {String} opts.signal
 * @param {number} opts.timeout
 * @param next
 */
// eslint-disable-next-line sonarjs/cognitive-complexity
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

export const parseGrid = (output: string) =>
  output
    ? formatOutput(parse(output, { format: IS_WIN ? 'win' : 'unix' }))
    : []

export const formatOutput = (data: TIngridResponse): TPsLookupEntry[] =>
  data.reduce<TPsLookupEntry[]>((m, d) => {
    const pid = d.PID?.[0]  || d.ProcessId?.[0]
    const ppid = d.PPID?.[0] || d.ParentProcessId?.[0]
    const cmd = d.CMD || d.CommandLine || d.COMMAND || []

    if (pid && cmd.length > 0) {
      const c = (cmd.findIndex((_v, i) => isBin(cmd.slice(0, i).join(' '))))
      const command = cmd.slice(0, c).join(' ')
      const args = cmd.length > 1 ? cmd.slice(c) : []

      m.push({
        pid: pid,
        ppid: ppid,
        command: command,
        arguments: args
      })
    }

    return m
  }, [])

export type PromiseResolve<T = any> = (value?: T | PromiseLike<T>) => void

const makeDeferred = <T = any, E = any>(): { promise: Promise<T>, resolve: PromiseResolve<T>, reject: PromiseResolve<E> } => {
  let resolve
  let reject
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { resolve, reject, promise } as any
}

const makePseudoDeferred = <T = any, E = any>(r = {}): { promise: any, resolve: any, reject: any } => {
  return {
    promise: r as any,
    resolve: identity,
    reject(e: any) {
      throw e
    }
  }
}

const noop = () => {/* noop */}

const identity = <T>(v: T): T => v
