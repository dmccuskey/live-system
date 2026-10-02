# Development

LiveSystem is at the design stage. The design is in [Architecture](architecture.md), and the reasons behind it are in the [decision records](decisions/).

## Current Baseline

The repository is a [Bun](https://bun.sh) workspace with every package in place. `micro-fsm` is implemented ([its README](../packages/micro-fsm/README.md)), and in `live-system/core` so are the `LifecycleRunner` ([Architecture](architecture.md#lifecyclerunner)), the `LiveSystem` class that boots and shuts down its managers ([Architecture](architecture.md#the-livesystem-object)), `BaseManager`, `LiveObject`, the `Unsubscribe` type and the optional `EventBus` ([Architecture](architecture.md#the-event-bus)). Commands are in place too: `core` has the `Command`, `CommandResponse` and `CommandError` types and the `fillRoute` helper, and `live-system/server` has the `Router` and the `CommandServer` ([Architecture](architecture.md#commands)). A `LiveSystem` given a router registers each manager's `routes()` in `addManager` and removes them on shutdown. Data is in place in `core` as well ([Architecture](architecture.md#data-and-record-sources)): the `RecordSource` interface and `MemoryRecordSource`, `defineRecordStore` for the Pinia store of one kind of record, `DataManager` with the startup sync, `LiveObjectManager`, which takes its live objects through `init()`, `start()` and `run()`, and the opt-in `debouncePatch`. `feathers-connect` is implemented ([its README](../packages/feathers-connect/README.md)): the `FeathersConnection` and the `FeathersRecordSource` over one of its services, which the demo's live server checks against `RecordSource`. `live-system/web` has the `CommandClient` ([Architecture](architecture.md#the-commandclient)) and `WebStartup`, which boots a web app's system and keeps its status as reactive state ([Architecture](architecture.md#starting-a-web-app)). Of the demo, the data service is implemented ([Demo Architecture](architecture-demo.md#the-data-service)), and so is the live server with its virtual users and servers ([Demo Architecture](architecture-demo.md#the-live-server)): users generate commands, servers run them within their capacity, and the servers are scaled automatically or by hand, by a setting ([Demo Architecture](architecture-demo.md#server-management)). A user's frustration rises with refused, delayed and aborted commands and falls as its commands complete ([Demo Architecture](architecture-demo.md#user-frustration)). The demo's web app is implemented in Vue 3 ([Demo Architecture](architecture-demo.md#the-web-app)): it mirrors the data service into its own stores, shows the users and the servers as they change, and sends the Demo User's commands.

| Package                                | Folder                                          | Depends on                                                                                                                                                           |
| -------------------------------------- | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `live-system`                          | `packages/live-system/`                         | `micro-fsm`, and from npm `pinia` and `vue`                                                                                                                          |
| `micro-fsm`                            | `packages/micro-fsm/`                           | nothing                                                                                                                                                              |
| `feathers-connect`                     | `packages/feathers-connect/`                    | nothing from this workspace, and from npm the Feathers client and `socket.io-client`                                                                                 |
| `@virtual-infrastructure/protocol`     | `examples/virtual-infrastructure/protocol/`     | `live-system`, for the command type and `fillRoute`                                                                                                                  |
| `@virtual-infrastructure/data-service` | `examples/virtual-infrastructure/data-service/` | the protocol, and from npm the Feathers server and its Socket.IO transport                                                                                           |
| `@virtual-infrastructure/live-server`  | `examples/virtual-infrastructure/live-server/`  | `live-system`, `feathers-connect`, the protocol, and from npm `pinia`                                                                                                |
| `@virtual-infrastructure/web`          | `examples/virtual-infrastructure/web/`          | `live-system`, `feathers-connect`, the protocol, and from npm `pinia` and `vue`. To develop it: Vite, `vue-tsc`, and for its tests `@vue/test-utils` and `happy-dom` |

`live-system` has no root entry point. Import from `live-system/core`, `live-system/server` or `live-system/web`.

`micro-fsm` and `feathers-connect` are built to move to repositories of their own, so neither may depend on `live-system`. Their tests check this. `feathers-connect` therefore satisfies `RecordSource` by its shape, without importing it, and a test in the demo's live server, which depends on both, fails the typecheck if the two drift apart.

The demo's protocol is laid out by domain: `users/` and `servers/` each hold a record, routes, commands and constants file, named with the domain first (`users.record.ts`, `users.routes.ts`, `users.commands.ts`, `users.constants.ts`), beside `services.ts` and `events.ts`. A command creator is named `create…Command`, for example `createAddUserCommand()`. Import a file by its path, for example `@virtual-infrastructure/protocol/users/users.record`.

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

### Running the Demo

The demo is a process per part. Start the data service first:

```sh
cd examples/virtual-infrastructure/data-service
bun run start
```

It listens on port 3030 and keeps its records in `data/virtual-infrastructure.sqlite` in its own folder, which it creates on the first start and Git ignores. Delete the file to start with no records. To change either, set `DATA_SERVICE_PORT` or `DATA_SERVICE_DB`. Stop it with Ctrl+C.

Then, in a second terminal, the live server:

```sh
cd examples/virtual-infrastructure/live-server
bun run start
```

It connects to the data service at `http://localhost:3030` and takes commands on port 3031. To change either, set `DATA_SERVICE_URL` or `LIVE_SERVER_PORT`. With no records it creates one server and one user, so commands begin to run at once. Stop it with Ctrl+C.

A command is a POST to `/command`. To add a user:

```sh
curl -X POST http://localhost:3031/command -H 'Content-Type: application/json' -d '{"route":"users/add"}'
```

Then, in a third terminal, the web app:

```sh
cd examples/virtual-infrastructure/web
bun run dev
```

Open `http://localhost:3032`. The page shows the users and the servers of the running system, and its controls send commands. To change the port, set `WEB_PORT`.

The web app is served by [Vite](https://vite.dev)'s dev server. Two addresses are involved:

| What     | Where it goes                                                                                       | To change it                |
| -------- | --------------------------------------------------------------------------------------------------- | --------------------------- |
| Records  | from the browser straight to the data service, on the page's host and port 3030                     | set `VITE_DATA_SERVICE_URL` |
| Commands | to `/command` on the dev server, which passes them on to the live server at `http://localhost:3031` | set `LIVE_SERVER_URL`       |

Commands go through the dev server because the `CommandServer` sends no CORS headers, and a browser will not post to another origin without them. `bun run build` builds the web app into `dist/`; whatever serves that must pass `/command` on in the same way.

### No Build Step

The packages export their TypeScript source: each `package.json` points its `exports` at files in `src/`, and nothing compiles them to JavaScript. Bun strips the types as it loads a file, so a change in one package is seen at once by the tests and by the demo, with no `dist/` folder to rebuild.

What follows from this:

- **`bun test` does not check types.** Bun removes them without checking them, so code with type errors can pass its tests. Run `bun run typecheck` as well.
- **The packages run under Bun or through a bundler, not under plain Node.js.** Node.js does not strip types from files under `node_modules`. A web app built with a bundler such as Vite is unaffected.
- **A package needs a build before it is published.** The build emits JavaScript and `.d.ts` files, and `exports` then points at those. This applies first to `micro-fsm` and `feathers-connect`, when they move to repositories of their own. It changes the package's `package.json`, not its source.

## Testing

Every change brings its tests ([ADR 012](decisions/012-bun-workspace-and-demo.md)). A test file sits beside the code it tests and is named `<file>.test.ts`.

### Vue Components

The demo's web app is the only package with `.vue` files, and two things are set up for them:

- **`bun test` compiles them.** The root `bunfig.toml` preloads `examples/virtual-infrastructure/web/test-support/preload.ts`, which registers a Bun plugin that compiles a `.vue` file's script and template (not its styles), and provides the DOM that Vue needs, from `happy-dom`. Only the DOM's own globals are added: `fetch` and the rest stay Bun's, because the server tests run in the same process. A component test mounts the component with `@vue/test-utils` and finds elements by their `data-test` attribute.
- **`bun run typecheck` checks them.** `tsc` does not read `.vue` files, so the root `tsconfig.json` leaves the web app out, and the web app has a `tsconfig.json` of its own, checked by `vue-tsc`. The root script runs both. `vue-tsc` is started by `web/scripts/typecheck.ts`, not by its own command: it patches `tsc` in a way that works under Node.js and not under Bun, and the script applies the same patch itself.

What a component computes is kept out of it, in plain TypeScript (`src/composables/`, `src/format.ts`), and tested without a DOM.

## Formatting

The style is in `.prettierrc`: no semicolons, single quotes, four spaces, trailing commas, lines up to 120 characters. An editor with [Prettier](https://prettier.io) formats a file on saving it. To format the whole repository by hand, from its root:

```sh
bun --bun x prettier --write .
```

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
