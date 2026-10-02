# Development

LiveSystem is at the design stage. The design is in [Architecture](architecture.md), and the reasons behind it are in the [decision records](decisions/).

## Current Baseline

The repository is a [Bun](https://bun.sh) workspace with every package in place. `micro-fsm` is implemented ([its README](../packages/micro-fsm/README.md)), and in `live-system/core` so are the `LifecycleRunner` ([Architecture](architecture.md#lifecyclerunner)), the `LiveSystem` class that boots and shuts down its managers ([Architecture](architecture.md#the-livesystem-object)), `BaseManager`, `LiveObject`, the `Unsubscribe` type and the optional `EventBus` ([Architecture](architecture.md#the-event-bus)). Commands are in place too: `core` has the `Command`, `CommandResponse` and `CommandError` types and the `fillRoute` helper, and `live-system/server` has the `Router` and the `CommandServer` ([Architecture](architecture.md#commands)). A `LiveSystem` given a router registers each manager's `routes()` in `addManager` and removes them on shutdown. Data is in place in `core` as well ([Architecture](architecture.md#data-and-record-sources)): the `RecordSource` interface and `MemoryRecordSource`, `defineRecordStore` for the Pinia store of one kind of record, `DataManager` with the startup sync, `LiveObjectManager`, which takes its live objects through `init()`, `start()` and `run()`, and the opt-in `debouncePatch`. The rest of `live-system` (`live-system/web`) and every other package is an empty shell with a test that proves it loads and resolves the packages it depends on.

| Package | Folder | Depends on |
|---|---|---|
| `live-system` | `packages/live-system/` | `micro-fsm`, and from npm `pinia` and `vue` |
| `micro-fsm` | `packages/micro-fsm/` | nothing |
| `feathers-connect` | `packages/feathers-connect/` | nothing from this workspace |
| `@virtual-infrastructure/protocol` | `examples/virtual-infrastructure/protocol/` | nothing |
| `@virtual-infrastructure/data-service` | `examples/virtual-infrastructure/data-service/` | the protocol |
| `@virtual-infrastructure/live-server` | `examples/virtual-infrastructure/live-server/` | `live-system`, `feathers-connect`, the protocol |
| `@virtual-infrastructure/web` | `examples/virtual-infrastructure/web/` | `live-system`, `feathers-connect`, the protocol |

`live-system` has no root entry point. Import from `live-system/core`, `live-system/server` or `live-system/web`.

`micro-fsm` and `feathers-connect` are built to move to repositories of their own, so neither may depend on `live-system`. Their tests check this.

The demo's protocol is laid out by domain: `users/` and `servers/` each hold `record.ts`, `routes.ts`, `commands.ts` and `constants.ts`, beside `services.ts` and `events.ts`. Import a file by its path, for example `@virtual-infrastructure/protocol/users/record`.

## Build and Test

Install [Bun](https://bun.sh/docs/installation), then from the repository root:

```sh
bun install          # install dependencies and link the workspace packages
bun test             # run every test in the workspace
bun run typecheck    # check the types of every package
```

To run the tests of one package, give its folder:

```sh
bun test packages/micro-fsm
```

### No Build Step

The packages export their TypeScript source: each `package.json` points its `exports` at files in `src/`, and nothing compiles them to JavaScript. Bun strips the types as it loads a file, so a change in one package is seen at once by the tests and by the demo, with no `dist/` folder to rebuild.

What follows from this:

- **`bun test` does not check types.** Bun removes them without checking them, so code with type errors can pass its tests. Run `bun run typecheck` as well.
- **The packages run under Bun or through a bundler, not under plain Node.js.** Node.js does not strip types from files under `node_modules`. A web app built with a bundler such as Vite is unaffected.
- **A package needs a build before it is published.** The build emits JavaScript and `.d.ts` files, and `exports` then points at those. This applies first to `micro-fsm` and `feathers-connect`, when they move to repositories of their own. It changes the package's `package.json`, not its source.

## Testing

Every change brings its tests ([ADR 012](decisions/012-bun-workspace-and-demo.md)). A test file sits beside the code it tests and is named `<file>.test.ts`.

## Branch Workflow

Work happens on a branch named for the change (`feat/`, `fix/`, `docs/`), created from an up-to-date `main`. A change that affects behavior updates the docs on the same branch.

## Possible Future Changes

These are ideas, not plans. Each needs discussion and a concrete use case before it is worked on.

- **Reconnecting to the data service.** A connection lost after startup means missed changes. The startup sync ([ADR 008](decisions/008-startup-sync.md)) would have to run again on reconnecting.
- **Other record sources** beside Feathers and the in-memory one, and with the first backend that does not create its own IDs, how IDs are assigned ([ADR 006](decisions/006-record-source-boundary.md)).
- **Telling a failed refetch from a removed record.** During the startup sync any failed `get` counts as a removal, so a network error at that moment drops the record from the store ([ADR 008](decisions/008-startup-sync.md)).
- **Authentication and permissions.** Out of scope for now ([ADR 013](decisions/013-server-web-symmetry.md)).
- **Typed payloads per route.** A command's data typed by its route ([ADR 009](decisions/009-commands-events-crud.md)).
- **A shared scheduling helper.** Only once several owners need the same thing ([ADR 015](decisions/015-timers-belong-to-owner.md)).
- **Generated protocol types**, from a schema or an API description ([ADR 010](decisions/010-applications-own-protocol.md)).
- **A devtools package** for inspecting a running system.
- **Docker images for the demo**, started with one command.
- **More examples.** A factory or warehouse simulator, and an application built in its own repository on the published packages.
