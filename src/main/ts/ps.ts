import ChildProcess from 'node:child_process'
import process from 'node:process'
import fs from 'node:fs'
import { parse } from '@webpod/ingrid'
import { exec, TSpawnCtx } from 'zurk/spawn'
import { EOL as SystemEOL } from 'node:os'

const IS_WIN = process.platform === 'win32'
const isBin = (f:string): boolean => fs.existsSync(f) && fs.lstatSync(f).isFile()

/**
 * End of line.
 * Basically, the EOL should be:
 * - windows: \r\n
 * - *nix: \n
 * But i'm trying to get every possibilities covered.
 */
const EOL = /(\r\n)|(\n\r)|\n|\r/;

/**
 * Query Process: Focus on pid & cmd
 * @param query
 * @param {String|String[]} query.pid
 * @param {String} query.command RegExp String
 * @param {String} query.arguments RegExp String
 * @param {String|array} query.psargs
 * @param {Function} callback
 * @param {Object=null} callback.err
 * @param {Object[]} callback.processList
 * @return {Object}
 */
export const lookup = (query, callback) => {

  /**
   * add 'lx' as default ps arguments, since the default ps output in linux like "ubuntu", wont include command arguments
   */
  const exeArgs = query.psargs || ['-lx']
  const filter: Record<string, any> = {}
  let idList: any;

  // Lookup by PID
  if (query.pid) {

    if (Array.isArray(query.pid)) {
      idList = query.pid;
    }
    else {
      idList = [query.pid];
    }

    // Cast all PIDs as Strings
    idList = idList.map((v: any) => v + '')
  }

  if (query.command) {
    filter['command'] = new RegExp(query.command, 'i');
  }

  if (query.arguments) {
    filter['arguments'] = new RegExp(query.arguments, 'i');
  }

  if (query.ppid) {
    filter['ppid'] = new RegExp(query.ppid);
  }

  const extractProcessList = (output: string) => {
    const processList = parseGrid(output.trim())
    const resultList: any[] = [];

    processList.forEach(function (p) {
      let flt;
      let type;
      let result = true;

      if (idList && idList.indexOf(String(p.pid)) < 0) {
        return;
      }

      for (type in filter) {
        flt = filter[type];
        result = flt.test(p[type]) ? result : false;
      }

      if (result) {
        resultList.push(p);
      }
    });

    return resultList
  }

  const args = typeof exeArgs === 'string' ? exeArgs.split(/\s+/) : exeArgs
  const ctx: TSpawnCtx = IS_WIN
    ? {
      cmd: 'cmd',
      input: 'wmic process get ProcessId,ParentProcessId,CommandLine \n',
      callback(err, {stdout}) {
        if (err) return callback(err)

        callback(null, extractProcessList(extractWmic(stdout)))
      },
      run(cb) {cb()}
    }
    : {
      cmd: 'ps',
      args,
      run(cb) {cb()},
      callback(err, {stdout}) {
        if (err) return callback(err)

        return callback(null, extractProcessList(stdout))
      }
    }

  exec(ctx)
};

export const extractWmic = (stdout: string): string => {
  const _stdout = stdout.split(EOL)
  let beginRow: number = 0

  // Find the line index for the titles
  _stdout.forEach((out, index) => {
    if (out && typeof beginRow == 'undefined' && out.indexOf('CommandLine') === 0) {
      beginRow = index
    }
  });

  // get rid of the start (copyright) and the end (current pwd)
  _stdout.splice(_stdout.length - 1, 1)
  _stdout.splice(0, beginRow)

  return _stdout.join(SystemEOL)
}

/**
 * Kill process
 * @param pid
 * @param {Object|String} signal
 * @param {String} signal.signal
 * @param {number} signal.timeout
 * @param next
 */
export const kill = (pid: string | number, signal, next ) => {
  //opts are optional
  if(!next && typeof signal == 'function'){
    next = signal;
    signal = undefined;
  }

  const checkTimeoutSeconds = (signal && signal.timeout) || 30;

  if (typeof signal === 'object') {
    signal = signal.signal;
  }

  try {
    process.kill(pid, signal);
  } catch(e) {
    return next && next(e);
  }

  let checkConfident = 0;
  let checkTimeoutTimer = null;
  let checkIsTimeout = false;

  function checkKilled(finishCallback) {
    lookup({ pid: pid }, function(err, list) {
      if (checkIsTimeout) return;

      if (err) {
        clearTimeout(checkTimeoutTimer);
        finishCallback && finishCallback(err);
      } else if(list.length > 0) {
        checkConfident = (checkConfident - 1) || 0;
        checkKilled(finishCallback);
      } else {
        checkConfident++;
        if (checkConfident === 5) {
          clearTimeout(checkTimeoutTimer);
          finishCallback && finishCallback();
        } else {
          checkKilled(finishCallback);
        }
      }
    });
  }

  next && checkKilled(next);

  checkTimeoutTimer = next && setTimeout(function() {
    checkIsTimeout = true;
    next(new Error('Kill process timeout'));
  }, checkTimeoutSeconds * 1000);
};

/**
 * Parse the stdout into readable object.
 * @param {String} output
 */
function parseGrid(output) {
  if (!output) {
    return [];
  }

  return formatOutput(parse(output));
}

/**
 * format the structure, extract pid, command, arguments, ppid
 * @param data
 * @return {Array}
 */

function formatOutput(data) {
  const formatedData = [];
  data.forEach(function (d) {
    const pid = ( d.PID && d.PID[0] ) || ( d.ProcessId && d.ProcessId[0] ) || undefined;
    const cmd = d.CMD || d.CommandLine || d.COMMAND || undefined;
    const ppid = ( d.PPID && d.PPID[0] ) || ( d.ParentProcessId && d.ParentProcessId[0] ) || undefined;

    if (pid && cmd) {
      const c = cmd.findIndex((_v, i) => isBin(cmd.slice(0, i).join(''))) - 1
      const command = cmd.slice(0, c).join('');
      let args = '';

      if (cmd.length > 1) {
        args = cmd.slice(c);
      }

      formatedData.push({
        pid: pid,
        command: command,
        arguments: args,
        ppid: ppid
      });
    }
  });

  return formatedData;
}
