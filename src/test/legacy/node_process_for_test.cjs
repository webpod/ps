var cp = require('node:child_process')
var process = require('node:process')
var now = Date.now();
var argv = process.argv.slice(2);
var marker = argv[0]
var fork = +argv.find(v => v.startsWith('--fork='))?.slice(7) || 0;
var depth = +argv.find(v => v.startsWith('--depth='))?.slice(8) || 0;
var from = +argv.find(v => v.startsWith('--from='))?.slice(7) || 0;

while(depth) {
  depth--
  const _fork = fork
  while (fork) {
    fork--
    cp.fork(__filename, [marker, `--depth=${depth}`, `--fork=${_fork}`, `--from=${process.pid}`])
  }
}

console.log('[child]', 'pid', process.pid, 'from=', from, 'argv=', argv);

setInterval(function () {
  doSomething();
}, 50);

function doSomething() {
  return null;
}
