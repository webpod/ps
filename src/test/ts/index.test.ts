import * as assert from 'node:assert'
import { describe, it } from 'node:test'
import { kill, lookup } from '../../main/ts/index.ts'

describe('index', () => {
  it('has proper exports', () => {
    assert.equal(typeof lookup, 'function')
    assert.equal(typeof kill, 'function')
  })
})
