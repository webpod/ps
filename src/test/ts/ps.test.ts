import * as assert from 'node:assert'
import { describe, it, before, after } from 'node:test'
import process from 'node:process'
import * as cp from 'node:child_process'
import * as path from 'node:path'
import { kill, lookup, tree } from '../../main/ts/ps.ts'

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
})
