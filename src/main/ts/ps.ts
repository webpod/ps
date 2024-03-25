import process from 'node:process'
import fs from 'node:fs'
import { parse, TIngridResponse } from '@webpod/ingrid'
import { exec, TSpawnCtx } from 'zurk/spawn'
import { EOL as SystemEOL } from 'node:os'

const EOL = /(\r\n)|(\n\r)|\n|\r/
const IS_WIN = process.platform === 'win32'
const isBin = (f:string): boolean => fs.existsSync(f) && fs.lstatSync(f).isFile()

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
  ppid?: string
  psargs?: string | string[]
}

export type TPsKillOptions = {
  timeout?: number
  signal?: string | number | NodeJS.Signals
}

export type TPsNext = (err?: any) => void

/**
 * Query Process: Focus on pid & cmd
 * @param query
 * @param {String|String[]} query.pid
 * @param {String} query.command RegExp String
 * @param {String} query.arguments RegExp String
 * @param {String|String[]} query.psargs
 * @param {Function} callback
 * @param {Object=null} callback.err
 * @param {Object[]} callback.processList
 * @return {Object}
 */
export const lookup = (query: TPsLookupQuery, callback: TPsLookupCallback) => {

  /**
   * add 'lx' as default ps arguments, since the default ps output in linux like "ubuntu", wont include command arguments
   */
  const { psargs = ['-lx'] } = query
  const args = typeof psargs === 'string' ? psargs.split(/\s+/) : psargs
  const ctx: TSpawnCtx = IS_WIN
    ? {
      cmd: 'cmd',
      input: 'wmic process get ProcessId,ParentProcessId,CommandLine \n',
      callback(err, {stdout}) {
        if (err) return callback(err)

        callback(null, parseProcessList(extractWmic(stdout), query))
      },
      run(cb) {cb()}
    }
    : {
      cmd: 'ps',
      args,
      run(cb) {cb()},
      callback(err, {stdout}) {
        if (err) return callback(err)

        return callback(null, parseProcessList(stdout, query))
      }
    }

  exec(ctx)
}

export const parseProcessList = (output: string, query: TPsLookupQuery = {}) => {
  type TFilterKeys = keyof Pick<TPsLookupQuery, 'command' | 'arguments'| 'ppid'>

  const processList = parseGrid(output.trim())
  const pidList= (query.pid === undefined ? [] : [query.pid].flat(1)).map(v => v + '')
  const filter = (['command', 'arguments', 'ppid'] as Array<TFilterKeys>)
    .reduce((m, k) => {
      const param = query[k]
      if (param) m[k] = new RegExp(param, 'i')
      return m
  }, {} as Record<TFilterKeys, RegExp>)

  return processList.filter(p =>
    (pidList.length === 0 || pidList.includes(p.pid)) && Object.keys(filter).every((type) => filter[type as TFilterKeys].test(p[type as keyof TPsLookupEntry] + ''))
  )
}

export const extractWmic = (stdout: string): string => {
  const _stdout = stdout.split(EOL)
  // Find the line index for the titles
  const beginRow = _stdout.findIndex((out) => out.indexOf('CommandLine') === 0)

  // get rid of the start (copyright) and the end (current pwd)
  // eslint-disable-next-line unicorn/prefer-negative-index
  _stdout.splice(_stdout.length - 1, 1)
  _stdout.splice(0, beginRow)

  return _stdout.join(SystemEOL)
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
export const kill = (pid: string | number, opts?: TPsNext | TPsKillOptions, next?: TPsNext ) => {
  if (typeof opts == 'function') {
    kill(pid, undefined, opts)
    return
  }
  const {
    timeout = 30 ,
    signal = 'SIGTERM'
  } = opts || {}

  try {
    process.kill(+pid, signal)
  } catch(e) {
    return next?.(e)
  }

  let checkConfident = 0
  let checkTimeoutTimer: NodeJS.Timeout
  let checkIsTimeout = false

  const checkKilled = (finishCallback?: TPsNext) =>
    lookup({ pid }, (err, list = []) => {
      if (checkIsTimeout) return

      if (err) {
        clearTimeout(checkTimeoutTimer)
        finishCallback?.(err)
      }

      else if (list.length > 0) {
        checkConfident = (checkConfident - 1) || 0
        checkKilled(finishCallback)
      }

      else {
        checkConfident++
        if (checkConfident === 5) {
          clearTimeout(checkTimeoutTimer)
          finishCallback?.()
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
  }
}


export const parseGrid = (output: string) =>
  output
    ? formatOutput(parse(output))
    : []

export const formatOutput = (data: TIngridResponse): TPsLookupEntry[] => {
  const formatedData: TPsLookupEntry[] = []
  data.forEach((d) => {
    const pid = d.PID?.[0]  || d.ProcessId?.[0] || undefined
    const ppid = d.PPID?.[0] || d.ParentProcessId?.[0] || undefined
    const cmd = d.CMD || d.CommandLine || d.COMMAND || undefined

    if (pid && cmd) {
      const c = cmd.findIndex((_v, i) => isBin(cmd.slice(0, i).join(''))) - 1
      const command = cmd.slice(0, c).join('')
      const args = cmd.length > 1 ? cmd.slice(c) : []

      formatedData.push({
        pid: pid,
        ppid: ppid,
        command: command,
        arguments: args
      })
    }
  })

  return formatedData
}
