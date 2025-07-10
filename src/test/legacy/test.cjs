// Inlined as is from the upstream to verify the backward compatibility
// https://github.com/neekey/ps/tree/master/test

var cp = require('node:child_process');
var assert = require('node:assert');
var Path = require('node:path');
var Sinon = require('sinon');

var ps = require('@webpod/ps');

var serverPath = Path.resolve(__dirname, './node_process_for_test.cjs');
var UpperCaseArg = '--UPPER_CASE';
var child = null;
var pid = null;

const { EOL : SystemEOL } = require('node:os')

function startProcess() {
  child = cp.fork(serverPath, [UpperCaseArg]);
  pid = child.pid;
}

function killProcess() {
  if (process.kill(pid, 0)) {
    process.kill(pid);
  }
}

var processKill = process.kill;

function mockKill() {
  process.kill = function() {};
}

function restoreKill() {
  process.kill = processKill;
}

// const fixture = cp.spawnSync('wmic process get ProcessId,ParentProcessId,CommandLine', [], { shell: true, encoding: 'utf-8', maxBuffer: 1024 * 1024 })
// console.log('stdout', fixture.stdout)
// const b64 = Buffer.from(fixture.stdout).toString('base64')
// console.log('stdout size:', fixture.stdout.length)
// console.log('fixture base64:', b64)

describe('test', function () {
  before(function (done) {
    ps.lookup({arguments: 'node_process_for_test'}, function (err, list) {
      var processLen = list.length;
      var killedCount = 0;
      if (processLen) {
        list.forEach(function (item) {
          ps.kill(item.pid, function () {
            killedCount++;
            if (killedCount === processLen) {
              done();
            }
          });
        });
      } else {
        done();
      }
    });
  });

  beforeEach(startProcess);

  describe('#lookup()', function () {

    afterEach(killProcess);

    it.only('get all processes', function (done) {
      ps.lookup({}, function (err, list) {
        console.log(err);
        console.log(list);
        done();
      });
    })

    it('by id', function (done) {
      ps.lookup({pid: pid}, function (err, list) {
        assert.equal(list.length, 1);
        assert.equal(list[0].arguments[0], serverPath);

        done();
      });
    });

    it('by command & arguments', function (done) {
      ps.lookup({command: '.*(node|iojs).*', arguments: 'node_process_for_test'}, function (err, list) {
        assert.equal(list.length, 1);
        assert.equal(list[0].pid, pid);
        assert.equal(list[0].arguments[0], serverPath);
        done();
      });
    });

    it('by arguments, the matching should be case insensitive ', function (done) {
      ps.lookup({arguments: 'UPPER_CASE'}, function (err, list) {
        assert.equal(list.length, 1);
        assert.equal(list[0].pid, pid);
        assert.equal(list[0].arguments[0], serverPath);

        ps.lookup({arguments: 'upper_case'}, function (err, list) {
          assert.equal(list.length, 1);
          assert.equal(list[0].pid, pid);
          assert.equal(list[0].arguments[0], serverPath);
          done();
        });
      });
    });

    it('empty result list should be safe ', function (done) {
      ps.lookup({command: 'NOT_EXIST', psargs: 'l'}, function (err, list) {
        assert.equal(list.length, 0);
        done();
      });
    });

    it('should work correctly with options `aux`', function (done) {
      ps.lookup({command: 'node', psargs: 'aux'}, function (err, list) {
        assert.equal(list.length > 0, true);
        list.forEach(function (row) {
          assert.equal(/^\d+$/.test(row.pid), true);
        });
        done();
      });
    });
  });

  describe('#kill()', function () {

    it('kill', function (done) {
      ps.lookup({pid}, function (err, list) {
        assert.equal(list.length, 1);
        ps.kill(pid, function (err) {
          assert.equal(err, null);
          ps.lookup({pid: pid}, function (err, list) {
            assert.equal(list.length, 0);
            done();
          });
        });
      });
    });

    it('should not throw an exception if the callback is undefined', function (done) {
      assert.doesNotThrow(function () {
        ps.kill(pid);
        ps.kill(pid, function() {
          done();
        });
      });
    });

    it('should force kill when opts.signal is SIGKILL', function (done) {
      ps.lookup({pid: pid}, function (err, list) {
        assert.equal(list.length, 1);
        ps.kill(pid, {signal: 'SIGKILL'}, function (err) {
          assert.equal(err, null);
          ps.lookup({pid: pid}, function (err, list) {
            assert.equal(list.length, 0);
            done();
          });
        });
      });
    });

    it('should throw error when opts.signal is invalid', function (done) {
      ps.lookup({pid: pid}, function (err, list) {
        assert.equal(list.length, 1);
        ps.kill(pid, {signal: 'INVALID'}, function (err) {
          assert.notEqual(err, null);
          ps.kill(pid, function(){
            done();
          });
        });
      });
    });
  });

  describe('#kill() timeout: ', function () {
    var clock;
    before(() => {
      clock = Sinon.useFakeTimers();
    })
    after(() => {
      clock.restore();
    })

    it('it should timeout after 30secs by default if the killing is not successful', function(done) {
      mockKill();
      var killStartDate = Date.now();

      ps.lookup({pid}, function (err, list) {
        assert.equal(list.length, 1);
        ps.kill(pid, function (err) {
          assert.equal(Date.now() - killStartDate >= 30 * 1000, true);
          assert.equal(err.message.indexOf('timeout') >= 0, true);
          restoreKill();
          ps.kill(pid, function(){
            clock.restore();
            done();
          });
        });
        clock.tick(30 * 1000);
      });
    });

    it('it should be able to set option to set the timeout', function(done) {
      mockKill();
      var killStartDate = Date.now();
      ps.lookup({pid: pid}, function (err, list) {
        assert.equal(list.length, 1);
        ps.kill(pid, { timeout: 5 }, function (err) {
          assert.equal(Date.now() - killStartDate >= 5 * 1000, true);
          assert.equal(err.message.indexOf('timeout') >= 0, true);
          restoreKill();
          ps.kill(pid, function(){
            Sinon.useFakeTimers
            done();
          });
        });
        clock.tick(5 * 1000);
      });
    });
  });
});
