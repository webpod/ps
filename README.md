# @webpod/ps

> A Node.js module for looking up running processes. Originated from [neekey/ps](https://github.com/neekey/ps), [UmbraEngineering/ps](https://github.com/UmbraEngineering/ps) and completely reforged.

## Features
- Written in TypeScript, ships with types
- CJS and ESM entry points
- Promise and callback API, sync variants
- Process tree traversal by parent pid
- Uses `@webpod/ingrid` instead of `table-parser` ([neekey/ps#76](https://github.com/neekey/ps/issues/76), [neekey/ps#62](https://github.com/neekey/ps/issues/62))

## Install
```bash
npm install @webpod/ps
```

## Internals

| Platform                  | Command                                                                                                                                       |
|---------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------|
| Unix / macOS              | `ps -eo pid,ppid,args`                                                                                                                       |
| Windows (kernel >= 26000) | `pwsh -NoProfile -Command "Get-CimInstance Win32_Process \| Select-Object ProcessId,ParentProcessId,CommandLine \| ConvertTo-Json -Compress"` |
| Windows (kernel < 26000)  | [`wmic`](https://learn.microsoft.com/en-us/windows/win32/wmisdk/wmic) `process get ProcessId,CommandLine`                                    |

## API

### lookup(query?, callback?)
Returns a list of processes matching the query.

```ts
import { lookup } from '@webpod/ps'

// Find by pid
const list = await lookup({ pid: 12345 })
// [{ pid: '12345', ppid: '123', command: '/usr/bin/node', arguments: ['server.js', '--port=3000'] }]

// Filter by command and/or arguments (treated as RegExp)
const nodes = await lookup({ command: 'node', arguments: '--debug' })

// Filter by parent pid
const children = await lookup({ ppid: 82292 })

// Synchronous
const all = lookup.sync()
```

On Unix, you can override the default `ps` arguments via `psargs`:
```ts
const list = await lookup({ command: 'node', psargs: '-eo pid,ppid,comm' })
```

Callback style is also supported:
```ts
lookup({ pid: 12345 }, (err, list) => { /* ... */ })
```

### tree(opts?, callback?)
Returns child processes of a given parent pid.

```ts
import { tree } from '@webpod/ps'

// Direct children
const children = await tree(123)
// [
//   { pid: '124', ppid: '123', command: 'node', arguments: ['worker.js'] },
//   { pid: '125', ppid: '123', command: 'node', arguments: ['worker.js'] }
// ]

// All descendants
const all = await tree({ pid: 123, recursive: true })
// [
//   { pid: '124', ppid: '123', ... },
//   { pid: '125', ppid: '123', ... },
//   { pid: '126', ppid: '124', ... },
//   { pid: '127', ppid: '125', ... }
// ]

// Synchronous
const list = tree.sync({ pid: 123, recursive: true })
```

### kill(pid, opts?, callback?)
Kills a process and waits for it to exit. The returned promise resolves once the process is confirmed dead, or rejects on timeout.

```ts
import { kill } from '@webpod/ps'

// Sends SIGTERM, polls until the process is gone (default timeout 30s)
await kill(12345)

// With signal
await kill(12345, 'SIGKILL')

// With custom timeout (seconds) and polling interval (ms)
await kill(12345, { signal: 'SIGKILL', timeout: 10, interval: 250 })

// With callback
await kill(12345, (err, pid) => {
  // called when the process is confirmed dead or timeout is reached
})
```

## License
[MIT](./LICENSE)
