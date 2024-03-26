# @webpod/ps

> A Node.js module for looking up running processes. Originated from [neekey/ps](https://github.com/neekey/ps), [UmbraEngineering/ps](https://github.com/UmbraEngineering/ps) and completely reforged.

## Differences
* [x] Rewritten in TypeScript
* [x] CJS and ESM package entry points
* [x] `table-parser` replaced with `@webpod/ingrid` to handle some issues: [neekey/ps#76](https://github.com/neekey/ps/issues/76), [neekey/ps#62](https://github.com/neekey/ps/issues/62), [neekey/table-parser#11](https://github.com/neekey/table-parser/issues/11), [neekey/table-parser#18](https://github.com/neekey/table-parser/issues/18)
* [x] Provides promisified responses
* [ ] Brings sync API
* [ ] Builds a process tree

## Install
```bash
$ npm install @webpod/ps
```

## Internals
This module invokes different tools to get process list:

* `ps` for unix/mac: `ps -lx`
* [`wmic` for win runtimes](https://learn.microsoft.com/en-us/windows/win32/wmisdk/wmic): `wmic process get ProcessId,CommandLine`.

## Usage

### lookup()
Searches for the process by the specified `pid`.
```ts
import {lookup} from '@webpod/ps'

// A simple pid lookup
lookup({pid: 12345}, (err, resultList) => {
  if (err) {
    throw new Error(err)
  }

  var process = resultList[0]
  if (process) {
    console.log('PID: %s, COMMAND: %s, ARGUMENTS: %s', process.pid, process.command, process.arguments)
  } else {
    console.log('No such process found!')
  }
})
```

Define a query opts to filter the results by `command` and/or `arguments` predicates:
```ts
lookup({
  command: 'node', // it will be used to build a regex 
  arguments: '--debug',
}, (err, resultList) => {
  if (err) {
    throw new Error(err)
  }

  resultList.forEach(process => {
    if (process) {
      console.log('PID: %s, COMMAND: %s, ARGUMENTS: %s', process.pid, process.command, process.arguments);
    }
  })
})
```

Unix users can override the default `ps` arguments:
```ts
lookup({
  command: 'node',
  psargs: 'ux'
}, (err, resultList) => {
// ...
})
```

Specify the `ppid` option to filter the results by the parent process id (make sure that your custom `psargs` provides this output: `-l` or `-j` for instance)
```ts
lookup({
  command: 'mongod',
  psargs: '-l',
  ppid: 82292
}, (err, resultList) => {
 // ...
})
```

### kill()
Eliminates the process by its `pid`.

```ts
import { kill } from '@webpod/ps'

kill('12345', err => {
  if (err) {
    throw new Error(err)
  } else {
    console.log('Process %s has been killed!', pid)
  }
})
```

Method `kill` also supports a `signal` option to be passed. It's only a wrapper of `process.kill()` with checking of that killing is finished after the method is called.

```ts
import { kill } from '@webpod/ps'

// Pass signal SIGKILL for killing the process without allowing it to clean up
kill('12345', 'SIGKILL', err => {
  if (err) {
    throw new Error(err)
  } else {
    console.log('Process %s has been killed without a clean-up!', pid)
  }
})
```

You can also use object notation to specify more opts:
```ts
kill( '12345', {
  signal: 'SIGKILL',
  timeout: 10,  // will set up a ten seconds timeout if the killing is not successful
}, () => {})
```

Notice that the nodejs build-in `process.kill()` does not accept number as a signal, you will have to use string format.

## License
[MIT](./LICENSE)
