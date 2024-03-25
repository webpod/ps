# @webpod/ps

> A Node.js module for looking up running processes. Originated from [neekey/ps](https://github.com/neekey/ps), [UmbraEngineering/ps](https://github.com/UmbraEngineering/ps) and completely reforged.

## Differences
* [x] Rewritten in TypeScript
* [x] CJS and ESM package entry points
* [x] `table-parser` replaced with `@webpod/ingrid` to handle some issues: [neekey/ps#76](https://github.com/neekey/ps/issues/76), [neekey/ps#62](https://github.com/neekey/ps/issues/62), [neekey/table-parser#11](https://github.com/neekey/table-parser/issues/11), [neekey/table-parser#18](https://github.com/neekey/table-parser/issues/18)
* [ ] Provides promisified responses
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
```javascript
var ps = require('@webpod/ps');

// A simple pid lookup
ps.lookup({pid: 12345}, function (err, resultList) {
  if (err) {
    throw new Error(err);
  }

  var process = resultList[0];

  if (process) {

    console.log('PID: %s, COMMAND: %s, ARGUMENTS: %s', process.pid, process.command, process.arguments);
  } else {
    console.log('No such process found!');
  }
});

```

Define a `RegExp/string` to filter the results by `command` and/or `arguments` match:

```javascript
var ps = require('@webpod/ps');

// A simple pid lookup
ps.lookup({
    command: 'node',
    arguments: '--debug',
    }, function(err, resultList ) {
    if (err) {
        throw new Error( err );
    }

    resultList.forEach(function( process ){
        if( process ){

            console.log( 'PID: %s, COMMAND: %s, ARGUMENTS: %s', process.pid, process.command, process.arguments );
        }
    });
});

```

### kill()
Eliminates the process by its `pid`.

```javascript
var ps = require('@webpod/ps');

// A simple pid lookup
ps.kill( '12345', function( err ) {
    if (err) {
        throw new Error( err );
    }
    else {
        console.log( 'Process %s has been killed!', pid );
    }
});
```

Method `kill` also supports a `signal` option to be passed. It's only a wrapper of `process.kill()` with checking of that killing is finished after the method is called.

```javascript
var ps = require('@webpod/ps');

// Pass signal SIGKILL for killing the process without allowing it to clean up
ps.kill( '12345', 'SIGKILL', function( err ) {
    if (err) {
        throw new Error( err );
    }
    else {
        console.log( 'Process %s has been killed without a clean-up!', pid );
    }
});
```

you can use object as the second parameter to pass more options:

```js
ps.kill( '12345', {
    signal: 'SIGKILL',
    timeout: 10,  // will set up a ten seconds timeout if the killing is not successful
}, function(){});

```

Notice that the nodejs build-in `process.kill()` does not accept number as the signal, you will have to use string format.


You can also pass arguments to `lookup` with `psargs` as arguments for `ps` command（Note that `psargs` is not available in windows):

```javascript
var ps = require('@webpod/ps');

// A simple pid lookup
ps.lookup({
    command: 'node',
    psargs: 'ux'
    }, function(err, resultList ) {
    if (err) {
        throw new Error( err );
    }

    resultList.forEach(function( process ){
        if( process ){
            console.log( 'PID: %s, COMMAND: %s, ARGUMENTS: %s', process.pid, process.command, process.arguments );
        }
    });
});

```

Lastly, you can filter a list of items by their PPID by passing a PPID to filter on. You will need to pass in a `psarg` that provides the PPID in the results (`-l` or `-j` for instance).

```javascript
var ps = require('@webpod/ps');

// A simple pid lookup
ps.lookup({
    command: 'mongod',
    psargs: '-l',
    ppid: 82292
    }, function(err, resultList ) {
    if (err) {
        throw new Error( err );
    }

    resultList.forEach(function( process ){
        if( process ){
            console.log( 'PID: %s, COMMAND: %s, ARGUMENTS: %s', process.pid, process.command, process.arguments );
        }
    });
});
```

## License
[MIT](./LICENSE)
