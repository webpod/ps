import process from 'node:process'
import fs from 'node:fs'
import { parse, TIngridResponse } from '@webpod/ingrid'
import { exec, TSpawnCtx } from 'zurk/spawn'
import { EOL as SystemEOL } from 'node:os'

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
 * @param {Function} cb
 * @param {Object=null} cb.err
 * @param {Object[]} cb.processList
 * @return {Object}
 */
export const lookup = (query: TPsLookupQuery = {}, cb: TPsLookupCallback = noop) => {
  const { promise, resolve, reject } = makeDeferred<TPsLookupEntry[]>()
  const { psargs = ['-lx'] } = query // add 'lx' as default ps arguments, since the default ps output in linux like "ubuntu", wont include command arguments
  const args = typeof psargs === 'string' ? psargs.split(/\s+/) : psargs
  const extract = IS_WIN ? extractWmic : identity
  const callback: TSpawnCtx['callback'] = (err, {stdout}) => {
    if (err) {
      reject(err)
      cb(err)
      return
    }

    const list = parseProcessList(extract(stdout), query)
    resolve(list)
    cb(null, list)
  }
  const ctx: TSpawnCtx = IS_WIN
    ? {
      cmd: 'cmd',
      input: 'wmic process get ProcessId,ParentProcessId,CommandLine \n',
      callback,
      run(cb) {cb()}
    }
    : {
      cmd: 'ps',
      args,
      run(cb) {cb()},
      callback,
    }

  exec(ctx)

  return promise
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

export const tree = async (opts: string | number | TPsTreeOpts, cb: TPsLookupCallback = noop): Promise<TPsLookupEntry[]> => {
  if (typeof opts === 'string' || typeof opts === 'number') {
    return tree({ pid: opts }, cb)
  }

  try {
    const {pid, recursive = false} = opts
    const list = pickTree(await lookup(), pid, recursive)

    cb(null, list)
    return list
  } catch (err) {
    cb(err)
    throw err
  }
}

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

export const makeDeferred = <T = any, E = any>(): { promise: Promise<T>, resolve: PromiseResolve<T>, reject: PromiseResolve<E> } => {
  let resolve
  let reject
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { resolve, reject, promise } as any
}

export const noop = () => {/* noop */}

export const identity = <T>(v: T): T => v
