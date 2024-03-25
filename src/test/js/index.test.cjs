const assert = require('node:assert')
const { describe, it } = require('node:test')
const { lookup, kill } = require('@webpod/ps')

describe('cjs index()', () => {
  it('has proper exports', () => {
    assert.equal(typeof lookup, 'function')
    assert.equal(typeof kill, 'function')
  })
})
