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

// Both callback and promise styles are supported
const list = await lookup({pid: 12345})

// or
lookup({pid: 12345}, (err, list) => {
  if (err) {
    throw new Error(err)
  }

  const [found] = list
  if (found) {
    console.log('PID: %s, COMMAND: %s, ARGUMENTS: %s', found.pid, found.command, found.arguments)
  } else {
    console.log('No such process found!')
  }
})
```

Define a query opts to filter the results by `command` and/or `arguments` predicates:
```ts
const list = await lookup({
  command: 'node', // it will be used to build a regex 
  arguments: '--debug',
})

list.forEach(entry => {
  console.log('PID: %s, COMMAND: %s, ARGUMENTS: %s', entry.pid, entry.command, entry.arguments);
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

kill('12345', (err, pid) => {
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
kill('12345', 'SIGKILL', (err, pid) => {
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
