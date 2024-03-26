import * as assert from 'node:assert'
import { describe, it } from 'node:test'
import ps, { kill, lookup, tree } from '../../main/ts/index.ts'

describe('index', () => {
  it('has proper exports', () => {
    assert.equal(ps.lookup, lookup)
    assert.equal(ps.kill, kill)
    assert.equal(ps.tree, tree)
    assert.equal(typeof lookup, 'function')
    assert.equal(typeof kill, 'function')
    assert.equal(typeof tree, 'function')
  })
})
