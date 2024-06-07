import * as assert from 'node:assert'
import { describe, it } from 'node:test'
import ps, { kill, lookup, tree, treeSync, lookupSync } from '../../main/ts/index.ts'

describe('index', () => {
  it('has proper exports', () => {
    assert.equal(ps.lookup, lookup)
    assert.equal(ps.lookup.sync, lookupSync)
    assert.equal(ps.kill, kill)
    assert.equal(ps.tree, tree)
    assert.equal(ps.tree.sync, treeSync)
    assert.equal(typeof lookup, 'function')
    assert.equal(typeof lookupSync, 'function')
    assert.equal(typeof kill, 'function')
    assert.equal(typeof tree, 'function')
    assert.equal(typeof treeSync, 'function')
  })
})
