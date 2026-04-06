import * as assert from 'node:assert'
import { describe, it, before, after } from 'node:test'
import process from 'node:process'
import * as cp from 'node:child_process'
import * as path from 'node:path'
import { kill, lookup, lookupSync, tree, treeSync, removeWmicPrefix, normalizeOutput } from '../../main/ts/ps.ts'
import { parse } from '@webpod/ingrid'
import { execSync } from 'node:child_process'

const __dirname = new URL('.', import.meta.url).pathname
const marker = Math.random().toString(16).slice(2)
const testScript = path.resolve(__dirname, '../legacy/node_process_for_test.cjs')
const testScriptArgs = [marker, '--foo', '--bar']

describe('lookup()', () => {
  let pid: number
  before(() => {
    pid = cp.fork(testScript, testScriptArgs).pid as number
  })

  after(() => {
    try {
      process.kill(pid)
    } catch (err) { void err }
  })

  it('returns a process list', async () => {
    const list = await lookup()
    assert.ok(list.length > 0)
  })

  it('searches process by pid', async () => {
    const list = await lookup({ pid })
    const found = list[0]

    assert.equal(list.length, 1)
    assert.equal(found.pid, pid)
  })

  it('filters by args', async () => {
    const list = await lookup({ arguments: marker })

    assert.equal(list.length, 1)
    assert.equal(list[0].pid, pid)
  })
})

describe('lookupSync()', () => {
  let pid: number
  before(() => {
    pid = cp.fork(testScript, testScriptArgs).pid as number
  })

  after(() => {
    try {
      process.kill(pid)
    } catch (err) { void err }
  })

  it('returns a process list', () => {
    const list = lookupSync()
    assert.ok(list.length > 0)
  })
  it('lookup.sync refs to lookupSync', () => {
    assert.equal(lookup.sync, lookupSync)
  })
})

describe('kill()', () => {
  it('kills a process', async () => {
    const pid = cp.fork(testScript, testScriptArgs).pid as number
    assert.equal((await lookup({ pid })).length, 1)
    await kill(pid)
    assert.equal((await lookup({ pid })).length, 0)
  })

  it('kills with check', async () => {
    let cheked = false
    const cb = () => cheked = true

    const pid = cp.fork(testScript, testScriptArgs).pid as number
    assert.equal((await lookup({ pid })).length, 1)

    const _pid = await kill(pid, {timeout: 1}, cb)
    assert.equal(pid, _pid)
    assert.equal((await lookup({ pid })).length, 0)
    assert.equal(cheked, true)
  })
})

describe('tree()', () => {
  it('returns 1st level child', async () => {
    const pid = cp.fork(testScript, [...testScriptArgs, '--fork=1', '--depth=2']).pid as number
    await new Promise(resolve => setTimeout(resolve, 2000)) // wait for child process to spawn

    const list = await lookup({ arguments: marker })
    const children = await tree(pid)
    const childrenAll = await tree({pid, recursive: true})

    await Promise.all(list.map(p => kill(p.pid)))
    await kill(pid)

    assert.equal(children.length, 1)
    assert.equal(childrenAll.length, 2)
    assert.equal(list.length, 3)

    assert.equal((await lookup({ arguments: marker })).length, 0)
  })

  it('returns all ps list if no opts provided', async () => {
    const list = await tree()
    assert.ok(list.length > 0)
  })
})

describe('treeSync()', () => {
  it('tree.sync refs to treeSync', () => {
    assert.equal(tree.sync, treeSync)
  })

  it('returns 1st level child', async () => {
    const pid = cp.fork(testScript, [...testScriptArgs, '--fork=1', '--depth=2']).pid as number
    await new Promise(resolve => setTimeout(resolve, 2000)) // wait for child process to spawn

    const list = lookupSync({ arguments: marker })
    const children = treeSync(pid)
    const childrenAll =  treeSync({pid, recursive: true})

    await Promise.all(list.map(p => kill(p.pid)))
    await kill(pid)

    assert.equal(children.length, 1)
    assert.equal(childrenAll.length, 2)
    assert.equal(list.length, 3)

    assert.equal((await lookup({ arguments: marker })).length, 0)
  })
})

describe('ps -eo vs ps -lx output comparison', () => {
  if (process.platform === 'win32') return

  let pid: number
  before(() => {
    pid = cp.fork(testScript, testScriptArgs).pid as number
  })
  after(() => {
    try { process.kill(pid) } catch { void 0 }
  })

  it('ps -eo pid,ppid,args returns valid entries', () => {
    const stdout = execSync('ps -eo pid,ppid,args').toString()
    const entries = normalizeOutput(parse(stdout, { format: 'unix' }))

    assert.ok(entries.length > 0, 'should return non-empty process list')
    for (const e of entries) {
      assert.ok(e.pid, 'each entry should have pid')
      assert.ok(e.command, 'each entry should have command')
    }
  })

  it('ps -eo finds a known process with correct fields', () => {
    const eoStdout = execSync('ps -eo pid,ppid,args').toString()
    const eoEntries = normalizeOutput(parse(eoStdout, { format: 'unix' }))
    const found = eoEntries.find(e => e.pid === String(pid))

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

    const eoStdout = execSync('ps -eo pid,ppid,args').toString()

    const lxEntries = normalizeOutput(parse(lxStdout, { format: 'unix' }))
    const eoEntries = normalizeOutput(parse(eoStdout, { format: 'unix' }))

    const lxFound = lxEntries.find(e => e.pid === String(pid))
    const eoFound = eoEntries.find(e => e.pid === String(pid))

    assert.ok(lxFound, `ps -lx should find process ${pid}`)
    assert.ok(eoFound, `ps -eo should find process ${pid}`)
    assert.equal(eoFound!.pid, lxFound!.pid, 'pid should match')
    assert.equal(eoFound!.ppid, lxFound!.ppid, 'ppid should match')
    assert.equal(eoFound!.command, lxFound!.command, 'command should match')
  })
})

describe('extractWmic()', () => {
  it('extracts wmic output', () => {
    const input = `CommandLine
ParentProcessId  ProcessId
0                0
                                                          7548             1400
"C:\\Windows\\System32\\Wbem\\WMIC.exe" process get ProcessId,ParentProcessId,CommandLine
                                                          1400             17424

PS C:\\Users\\user>`

    const sliced = removeWmicPrefix(input).trim()

    assert.equal(sliced, input.slice(0, -'PS C:\\Users\\user>'.length -1).trim())
  })
})
