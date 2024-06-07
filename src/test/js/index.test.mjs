import assert from 'node:assert'
import { describe, it } from 'node:test'
import { lookup, kill, tree } from '@webpod/ps'

describe('mjs index', () => {
  it('has proper exports', () => {
    assert.equal(typeof lookup, 'function')
    assert.equal(typeof lookup.sync, 'function')
    assert.equal(typeof tree, 'function')
    assert.equal(typeof tree.sync, 'function')
    assert.equal(typeof kill, 'function')
  })
})
