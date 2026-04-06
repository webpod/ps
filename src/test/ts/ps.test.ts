import * as assert from 'node:assert'
import { describe, it, before, after } from 'node:test'
import process from 'node:process'
import { fork, execSync } from 'node:child_process'
import * as path from 'node:path'
import { kill, lookup, lookupSync, tree, treeSync, removeWmicPrefix, normalizeOutput, filterProcessList } from '../../main/ts/ps.ts'
import { parse } from '@webpod/ingrid'

const __dirname = new URL('.', import.meta.url).pathname
const marker = Math.random().toString(16).slice(2)
const testScript = path.resolve(__dirname, '../legacy/node_process_for_test.cjs')
const testScriptArgs = [marker, '--foo', '--bar']
const SPAWN_DELAY = 2000

const spawnChild = (...extra: string[]) =>
  fork(testScript, [...testScriptArgs, ...extra]).pid as number

const killSafe = (pid: number) => {
  try { process.kill(pid) } catch {}
}

describe('lookup()', () => {
  let pid: number
  before(() => { pid = spawnChild() })
  after(() => killSafe(pid))

  it('returns a process list', async () => {
    const list = await lookup()
    assert.ok(list.length > 0)
  })

  it('searches process by pid', async () => {
    const list = await lookup({ pid })
    assert.equal(list.length, 1)
    assert.equal(list[0].pid, pid)
  })

  it('filters by args', async () => {
    const list = await lookup({ arguments: marker })
    assert.equal(list.length, 1)
    assert.equal(list[0].pid, pid)
  })

  if (process.platform !== 'win32') {
    it('supports custom psargs', async () => {
      const list = await lookup({ pid, psargs: '-eo pid,ppid,args' })
      assert.equal(list.length, 1)
      assert.equal(list[0].pid, pid)
    })
  }
})

describe('lookupSync()', () => {
  let pid: number
  before(() => { pid = spawnChild() })
  after(() => killSafe(pid))

  it('returns a process list', () => {
    assert.ok(lookupSync().length > 0)
  })

  it('lookup.sync refs to lookupSync', () => {
    assert.equal(lookup.sync, lookupSync)
  })
})

describe('kill()', () => {
  it('kills a process', async () => {
    const pid = spawnChild()
    assert.equal((await lookup({ pid })).length, 1)
    await kill(pid)
    assert.equal((await lookup({ pid })).length, 0)
  })

  it('kills with check', async () => {
    let checked = false
    const pid = spawnChild()
    assert.equal((await lookup({ pid })).length, 1)

    const result = await kill(pid, { timeout: 1 }, () => { checked = true })
    assert.equal(result, pid)
    assert.equal((await lookup({ pid })).length, 0)
    assert.ok(checked)
  })
})

describe('tree()', () => {
  it('returns 1st level child', async () => {
    const pid = spawnChild('--fork=1', '--depth=2')
    await new Promise(resolve => setTimeout(resolve, SPAWN_DELAY))

    const list = await lookup({ arguments: marker })
    const children = await tree(pid)
    const childrenAll = await tree({ pid, recursive: true })

    await Promise.all(list.map(p => kill(p.pid)))

    assert.equal(children.length, 1)
    assert.equal(childrenAll.length, 2)
    assert.equal(list.length, 3)
    assert.equal((await lookup({ arguments: marker })).length, 0)
  })

  it('returns all ps list if no opts provided', async () => {
    assert.ok((await tree()).length > 0)
  })
})

describe('treeSync()', () => {
  it('tree.sync refs to treeSync', () => {
    assert.equal(tree.sync, treeSync)
  })

  it('returns 1st level child', async () => {
    const pid = spawnChild('--fork=1', '--depth=2')
    await new Promise(resolve => setTimeout(resolve, SPAWN_DELAY))

    const list = lookupSync({ arguments: marker })
    const children = treeSync(pid)
    const childrenAll = treeSync({ pid, recursive: true })

    await Promise.all(list.map(p => kill(p.pid)))

    assert.equal(children.length, 1)
    assert.equal(childrenAll.length, 2)
    assert.equal(list.length, 3)
    assert.equal((await lookup({ arguments: marker })).length, 0)
  })
})

describe('ps -eo vs ps -lx output comparison', { skip: process.platform === 'win32' }, () => {
  let pid: number
  before(() => { pid = spawnChild() })
  after(() => killSafe(pid))

  it('ps -eo pid,ppid,args returns valid entries', () => {
    const entries = normalizeOutput(parse(execSync('ps -eo pid,ppid,args').toString(), { format: 'unix' }))

    assert.ok(entries.length > 0, 'should return non-empty process list')
    for (const e of entries) {
      assert.ok(e.pid, 'each entry should have pid')
      assert.ok(e.command, 'each entry should have command')
    }
  })

  it('ps -eo finds a known process with correct fields', () => {
    const entries = normalizeOutput(parse(execSync('ps -eo pid,ppid,args').toString(), { format: 'unix' }))
    const found = entries.find(e => e.pid === String(pid))

    assert.ok(found, `ps -eo should find spawned process ${pid}`)
    assert.equal(found!.pid, String(pid))
    assert.ok(found!.ppid, 'should have ppid')
    assert.ok(found!.command, 'should have command')
    assert.ok(found!.arguments.join(' ').includes(marker), 'should contain marker in args')
  })

  it('ps -eo and ps -lx return matching data for the same process', () => {
    let lxStdout: string
    try {
      lxStdout = execSync('ps -lx').toString()
    } catch {
      return // ps -lx not available (e.g. BusyBox) — skip
    }

    const lxEntries = normalizeOutput(parse(lxStdout, { format: 'unix' }))
    const eoEntries = normalizeOutput(parse(execSync('ps -eo pid,ppid,args').toString(), { format: 'unix' }))

    const lxFound = lxEntries.find(e => e.pid === String(pid))
    const eoFound = eoEntries.find(e => e.pid === String(pid))

    assert.ok(lxFound, `ps -lx should find process ${pid}`)
    assert.ok(eoFound, `ps -eo should find process ${pid}`)
    assert.equal(eoFound!.pid, lxFound!.pid, 'pid should match')
    assert.equal(eoFound!.ppid, lxFound!.ppid, 'ppid should match')
    assert.equal(eoFound!.command, lxFound!.command, 'command should match')
  })
})

describe('kill() edge cases', () => {
  it('rejects when killing a non-existent pid', async () => {
    await assert.rejects(() => kill(999_999), { code: 'ESRCH' })
  })

  it('rejects with invalid signal', async () => {
    const pid = spawnChild()
    await assert.rejects(() => kill(pid, 'INVALID'))
    killSafe(pid)
  })

  it('passes signal as string shorthand', async () => {
    const pid = spawnChild()
    await kill(pid, 'SIGKILL')
    assert.equal((await lookup({ pid })).length, 0)
  })

  it('invokes callback on error for non-existent pid', async () => {
    let cbErr: any
    await kill(999_999, (err) => { cbErr = err }).catch(() => {})
    assert.ok(cbErr)
  })
})

describe('kill() timeout', { skip: process.platform === 'win32' }, () => {
  it('rejects on timeout when process stays alive', async () => {
    // Signal 0 checks existence but doesn't actually kill — process stays alive, so poll times out
    const pid = spawnChild()
    await assert.rejects(
      () => kill(pid, { signal: 0 as any, timeout: 1 }),
      (err: Error) => err.message.includes('timeout')
    )
    killSafe(pid)
  })
})

describe('tree() edge cases', () => {
  it('accepts string pid', async () => {
    const pid = spawnChild()
    const children = await tree(String(pid))
    assert.ok(Array.isArray(children))
    killSafe(pid)
  })

  it('treeSync accepts number pid', () => {
    const pid = spawnChild()
    const children = treeSync(pid)
    assert.ok(Array.isArray(children))
    killSafe(pid)
  })
})

describe('filterProcessList()', () => {
  const list = [
    { pid: '1', ppid: '0', command: '/usr/bin/node', arguments: ['server.js', '--port=3000'] },
    { pid: '2', ppid: '1', command: '/usr/bin/python', arguments: ['app.py'] },
    { pid: '3', ppid: '1', command: '/usr/bin/node', arguments: ['worker.js'] },
  ]

  it('filters by pid array', () => {
    assert.equal(filterProcessList(list, { pid: ['1', '3'] }).length, 2)
  })

  it('filters by command regex', () => {
    assert.equal(filterProcessList(list, { command: 'node' }).length, 2)
  })

  it('filters by arguments regex', () => {
    assert.equal(filterProcessList(list, { arguments: 'port' }).length, 1)
  })

  it('filters by ppid', () => {
    assert.equal(filterProcessList(list, { ppid: 1 }).length, 2)
  })

  it('returns all when no filters', () => {
    assert.equal(filterProcessList(list).length, 3)
  })
})

describe('normalizeOutput()', () => {
  it('skips entries without pid', () => {
    const data = [{ COMMAND: ['node'] }] as any
    assert.equal(normalizeOutput(data).length, 0)
  })

  it('skips entries without command', () => {
    const data = [{ PID: ['1'] }] as any
    assert.equal(normalizeOutput(data).length, 0)
  })

  it('handles ARGS header (macOS)', () => {
    const data = [{ PID: ['1'], PPID: ['0'], ARGS: ['/usr/bin/node server.js'] }] as any
    const result = normalizeOutput(data)
    assert.equal(result.length, 1)
    assert.ok(result[0].command)
  })

  it('handles quoted paths on Windows', () => {
    const data = [{
      ProcessId: ['1'],
      ParentProcessId: ['0'],
      CommandLine: ['"C:\\Program Files\\node.exe" server.js']
    }] as any
    const result = normalizeOutput(data)
    assert.equal(result.length, 1)
  })
})

describe('removeWmicPrefix()', () => {
  it('extracts wmic output', () => {
    const input = `CommandLine
ParentProcessId  ProcessId
0                0
                                                          7548             1400
"C:\\Windows\\System32\\Wbem\\WMIC.exe" process get ProcessId,ParentProcessId,CommandLine
                                                          1400             17424

PS C:\\Users\\user>`

    const sliced = removeWmicPrefix(input).trim()
    assert.equal(sliced, input.slice(0, -'PS C:\\Users\\user>'.length - 1).trim())
  })

  it('handles output without prompt suffix', () => {
    const input = `ParentProcessId  ProcessId\n0                1`
    const result = removeWmicPrefix(input)
    assert.ok(result.includes('ProcessId'))
  })
})
