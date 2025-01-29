## [0.0.1](https://github.com/webpod/ps/compare/undefined...v0.0.1) (2025-01-29)

### Fixes & improvements
* perf(deps): update zurk to v0.10.2 ([eca50f0](https://github.com/webpod/ps/commit/eca50f0e73be5ac4e7c5d9a8f94d16c62ac65f79))
* perf: update zurk to v0.10.0 ([be969d9](https://github.com/webpod/ps/commit/be969d97d614197473d00fe1e6656e0dc6369832))
* fix: added missing references to `package.json` ([8bcfb02](https://github.com/webpod/ps/commit/8bcfb028b958d708e6362818e860446ca985fb9b))
* perf: up zurk to v0.9.2, up dev deps ([64d28a7](https://github.com/webpod/ps/commit/64d28a7a0af09bc948ece45bcf2a849959a57648))
* perf: update zurk to v0.6.2, up dev deps ([3ff0cde](https://github.com/webpod/ps/commit/3ff0cde38ef2eb8e771ece2418939ca3b5f41243))
* perf: up zurk to v0.6.0 ([de0c5fc](https://github.com/webpod/ps/commit/de0c5fc7c7c0e487d9b5934662eda5eb67e49b22))
* perf: up deps ([ce8abc3](https://github.com/webpod/ps/commit/ce8abc35b8acf23373b9adce9f757d01121e866c))
* fix: enhance err handling ([2291f50](https://github.com/webpod/ps/commit/2291f509946a7ce9e43b1dd90fc50fad12f90dc1))
* fix: mix sync methods to default export ([8a5ab95](https://github.com/webpod/ps/commit/8a5ab95d23689c770d668aaf9ae8b859c9e4cf12))
* fix: do not require `allowImportingTsExtensions` ([048db11](https://github.com/webpod/ps/commit/048db114b2c5e478b762ff42724cfb357d11b03c))
* fix: ppid search should use strict equal cond ([3804857](https://github.com/webpod/ps/commit/38048570ea1f57a3da59988da78238204af7ada6))
* fix(parse): specify format for wmic output ([3ae0dcb](https://github.com/webpod/ps/commit/3ae0dcbf9c0a1ce1edc21052755dc0d188c3c287))
* fix: extractWmic ([2de556f](https://github.com/webpod/ps/commit/2de556f1b1e6731f8e6d5b31af0669c99df9ac63))
* docs: rn readme ([82b3a08](https://github.com/webpod/ps/commit/82b3a08aeaa1d7e8a03c22a3d224fc818894b83e))
* docs: update usage examples ([528ed85](https://github.com/webpod/ps/commit/528ed856b1d86fb99ccd750f3a45163cb2557d41))
* fix: let kill opt be a signal shortcut ([14fad84](https://github.com/webpod/ps/commit/14fad847587ab1de0cf28ea3612839d7a59615f1))
* refactor: finalize ts migration (src part) ([8aa1a93](https://github.com/webpod/ps/commit/8aa1a9383327d9bde5ba81356013edb4c19876d0))
* refactor: use zurk as spawner ([0d19b51](https://github.com/webpod/ps/commit/0d19b5184dc3c411adbab6a3721a8304a93a3b5a))

### Features
* feat: add `tree.sync` and `lookup.sync` ([871d44d](https://github.com/webpod/ps/commit/871d44d8fb90844af7496806fa7d1ac5fd15a31d))
* feat: let `tree` opts be optional ([7e25163](https://github.com/webpod/ps/commit/7e25163d676b616b188428134d2cc7eb9a0a3748))
* feat: provide `tree` API ([611065d](https://github.com/webpod/ps/commit/611065dec82c6ed51b7de315721eaebc44b98111))
* feat: return pid as `kill` response ([b267d07](https://github.com/webpod/ps/commit/b267d0780c0229990cb24452b8fd5cdf9e44ff69))
* feat: promisify responses ([c4ff62d](https://github.com/webpod/ps/commit/c4ff62d4731adeaf89dd0e9e055c17a7bb477686))

## [2017-04-21](https://github.com/neekey/ps/pull/48)
- publish 0.1.6
- use `lx` as default options for `ps` command
- remove debugging console log for `kill()`
- add timeout for `kill()`, default to 30s

## [2017-03-26](https://github.com/neekey/ps/pull/35)
- publish 0.1.5
- Add parent process ID support for windows
- use `spawn` to replace `exec` for Linux/Unix system
- add appVeyor integration
- use Travis for npm publishing
- refactor the implementation of `kill()`, now just a wrapper of built-in `process.kill()`

## 2016-06-23
- Publish 0.1.2
- change `command` and `argument` matching to case insensitive.

## 2016-05-05
- Publish 0.1.1 update table-parser to 0.1.1
- Integrate with Travis-CI linux / mac is fully tested now
- Manually test on Win10 and Win7

## 2016-04-26
- Publish 0.1.0 update table-parser to 0.1.0

## 2015-09-20

- Publish 0.0.5.
- Merge [#5](https://github.com/neekey/ps/pull/5): Add license type MIT.
- Merge [#6](https://github.com/neekey/ps/pull/6): Allow for stdout to return the data in chunks.
