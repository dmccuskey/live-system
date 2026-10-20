# live-system

The LiveSystem framework: the lifecycle, managers, live objects, commands, events and the record store. The design and the guides are in the [LiveSystem repository](https://github.com/dmccuskey/live-system#readme). This page is about using the package from another project.

## Install

The package is not on npm. Each version is a tarball attached to a release in the LiveSystem repository, under a tag `live-system-v<version>`. Install it by its URL:

```sh
bun add live-system@https://github.com/dmccuskey/live-system/releases/download/live-system-v0.1.0/live-system-0.1.0.tgz
bun add @vue/reactivity
```

`bun.lock` records the tarball's integrity. To move to another version, change the URL in `package.json` and run `bun install`. The [releases](https://github.com/dmccuskey/live-system/releases) list the versions, and the [changelog](CHANGELOG.md) what each changed.

The repository is public, so a Docker build installs it with no token. The install fetches from `github.com` and `codeload.github.com`: the tarball, and `@dmccuskey/micro-fsm`, which the package takes from GitHub at a tag.

## Entry Points

There is no root entry point. Import from a subpath:

| Import               | Holds                                                                                                                     |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `live-system/core`   | the lifecycle, `LiveSystem`, managers, live objects, commands, record sources, the record store, the event bus, the clock |
| `live-system/server` | the `Router` and the `CommandServer`                                                                                      |
| `live-system/web`    | the `CommandClient`, `WebStartup` and `readable()`                                                                        |
| `live-system/pinia`  | `defineRecordStore`, the record store as a Pinia store                                                                    |

## Peer Dependencies

- **`@vue/reactivity` `^3.5`**, always: the record store is built on it, on the server as on the web. A Vue app gets it through `vue`. Declare it at the version `vue` brings, so that one copy is installed: two copies do not see each other's changes.
- **`pinia` `^4`**, only for `live-system/pinia`.

## TypeScript

The package holds its TypeScript source, not built JavaScript, and its imports name their `.ts` files. Bun and Vite read it as it is. The project's `tsconfig.json` needs:

```json
{
    "compilerOptions": {
        "module": "Preserve",
        "moduleResolution": "bundler",
        "allowImportingTsExtensions": true,
        "noEmit": true,
        "types": ["bun"]
    }
}
```

`tsc` checks the package's source under the project's own options, since `skipLibCheck` skips only `.d.ts` files. The package passes `strict` with `noUncheckedIndexedAccess`, `noImplicitOverride` and `verbatimModuleSyntax`. An option stricter than those, such as `exactOptionalPropertyTypes`, reports errors inside the package. The [repository's `tsconfig.json`](https://github.com/dmccuskey/live-system/blob/main/tsconfig.json) is a good one to start from.

## Runtime

- **`live-system/server` runs on Bun:** `CommandServer.listen()` serves with `Bun.serve`. Its `handle()` takes a standard `Request`, so it can also be put behind another server.
- **Not under plain Node.js:** Node.js does not strip types from files under `node_modules`. A web app built with a bundler such as Vite is unaffected.

## A Vue App

- **Type checking under Bun:** `vue-tsc` finds no `.vue` file when Bun runs it, because Bun's `require` does not go through the `fs.readFileSync` that `vue-tsc` patches. Under Node.js it works as it is. To run it under Bun, copy the demo's [`scripts/typecheck.ts`](https://github.com/dmccuskey/live-system/blob/main/examples/virtual-infrastructure/web/scripts/typecheck.ts) and run `bun scripts/typecheck.ts --noEmit`.
- **Component tests on `bun test`:** the package needs no test setup. To test `.vue` components with `bun test`, the project preloads a plugin that compiles them and a DOM, as the demo does in its [`test-support/preload.ts`](https://github.com/dmccuskey/live-system/blob/main/examples/virtual-infrastructure/web/test-support/preload.ts), named under `[test] preload` in `bunfig.toml`.

## Trying an Unreleased Change

To try a change before it is released, pack the checkout and install the tarball, as a release would be installed:

```sh
cd packages/live-system && bun pm pack --destination <folder>
```

then, in the project that uses it, `"live-system": "file:<folder>/live-system-0.1.0.tgz"` and `bun install`. Pack again after each change. Put the release's URL back before committing.

A link to the checkout (`bun link`, or `link:`) works for code on `live-system/core` and `live-system/server`, but not in a Vue app: the linked package takes `vue`, `@vue/reactivity` and `pinia` from the checkout's own `node_modules`, so two copies load. Pinia then finds no active Pinia, and a `computed` over a store does not follow it.

## License

[MIT](LICENSE)
