# Development

LiveSystem's primitives are implemented, and the demo runs on them. The design is in [Architecture](architecture.md), and the reasons behind it are in the [decision records](decisions/).

## Current Baseline

The repository is a [Bun](https://bun.sh) workspace with every package in place. `micro-fsm` is implemented ([its README](../packages/micro-fsm/README.md)), and in `live-system/core` so are the `LifecycleRunner` ([Architecture](architecture.md#lifecyclerunner)), the `LiveSystem` class that boots and shuts down its managers ([Architecture](architecture.md#the-livesystem-object)), `BaseManager`, `LiveObject`, the `Unsubscribe` type and the optional `EventBus` ([Architecture](architecture.md#the-event-bus)). Commands are in place too: `core` has the `Command`, `CommandResponse` and `CommandError` types and the `fillRoute` helper, and `live-system/server` has the `Router` and the `CommandServer` ([Architecture](architecture.md#commands)). A `LiveSystem` given a router registers each manager's `routes()` in `addManager` and removes them on shutdown. Data is in place in `core` as well ([Architecture](architecture.md#data-and-record-sources)): the `RecordSource` interface and `MemoryRecordSource`, `defineRecordStore` for the Pinia store of one kind of record, `DataManager` with the startup sync and the resync after a lost connection, `LiveObjectManager`, which takes its live objects through `init()`, `start()` and `run()`, the opt-in `debouncePatch`, and the `Clock` with its `systemClock`, `scaledClock` and `FakeClock` ([Architecture](architecture.md#time)). `feathers-connect` is implemented ([its README](../packages/feathers-connect/README.md)): the `FeathersConnection` and the `FeathersRecordSource` over one of its services, which the demo's live server checks against `RecordSource`. `live-system/web` has the `CommandClient` ([Architecture](architecture.md#the-commandclient)) and `WebStartup`, which boots a web app's system and keeps its status as reactive state ([Architecture](architecture.md#starting-a-web-app)). Of the demo, the data service is implemented ([Demo Architecture](architecture-demo.md#the-data-service)), and so is the live server with its virtual users and servers ([Demo Architecture](architecture-demo.md#the-live-server)): users generate commands, servers run them within their capacity, and the servers are scaled automatically or by hand, by a setting ([Demo Architecture](architecture-demo.md#server-management)). A user's frustration rises with refused, delayed and aborted commands and falls as its commands complete ([Demo Architecture](architecture-demo.md#user-frustration)). The demo's web app is implemented in Vue 3 ([Demo Architecture](architecture-demo.md#the-web-app)): it mirrors the data service into its own stores, shows the users and the servers as they change, and sends the Demo User's commands.

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

The demo's protocol is laid out by domain: `users/`, `servers/` and `managers/` each hold a record, routes, commands and constants file, named with the domain first (`users.record.ts`, `users.routes.ts`, `users.commands.ts`, `users.constants.ts`), beside `services.ts` and `events.ts`. A command creator is named `create…Command`, for example `createAddUserCommand()`. Import a file by its path, for example `@virtual-infrastructure/protocol/users/users.record`.

## Design Guidelines

What to keep to when writing a manager or a live object, each explained in the [Architecture](architecture.md):

| Guideline                                                                                                                                                             | Where                                                                         |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Each phase has its work: `init()` reads own records, `start()` begins to watch, `run()` acts. The order of the managers never matters                                 | [Each Phase Has Its Work](architecture.md#each-phase-has-its-work)            |
| Data is shared through the store first. Every store is a projection of the data service, and a part that needs data another part owns watches the store               | [Sharing Data: the Store First](architecture.md#sharing-data-the-store-first) |
| The event bus is for "special" communication: live objects among themselves, and a part reporting data for a record it does not own                                   | [Event Sources](architecture.md#event-sources)                                |
| A live object keeps its record's ID, not the record. A change reaches it through the store, never through its manager, and it does not read back the fields it writes | [The Object and Its Record](architecture.md#the-object-and-its-record)        |
| A manager is not written for a single record. A record that belongs to a manager carries that manager's `key`, and the required ones are a table in the protocol      | [A Record per Manager](architecture.md#a-record-per-manager)                  |
| Routes are only for what a web app sends in. Inside the system nothing sends a command or calls a manager directly: the parts react to the store and the event bus    | [Who Sends Commands](architecture.md#who-sends-commands)                      |

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

Both answer a GET to `/health`, for whatever starts or watches them. The data service answers 200 while its database does. The live server answers 200 while it is connected to the data service, and 503 while it is not:

```sh
curl http://localhost:3030/health
curl http://localhost:3031/health
```

By default any client of the data service may write its records. To make them read-only from outside, give the data service and the live server the same `DATA_SERVICE_WRITE_TOKEN`: the live server sends it as it connects, and a client that did not send it (the web app, or anything else that reaches the data service) can read and listen but is refused every write. The web app never writes: it sends commands.

Then, in a third terminal, the web app:

```sh
cd examples/virtual-infrastructure/web
bun run dev
```

Open `http://localhost:3032`. The page shows the users and the servers of the running system, and its controls send commands. To change the port, set `WEB_PORT`.

The web app is served by [Vite](https://vite.dev)'s dev server, and talks to its own origin only. The dev server passes two paths on, and answers a third:

| What          | Path           | Where it goes                                             | To change it                                             |
| ------------- | -------------- | --------------------------------------------------------- | -------------------------------------------------------- |
| Records       | `/socket.io`   | passed on to the data service, at `http://localhost:3030` | set `DATA_SERVICE_URL`                                   |
| Commands      | `/command`     | passed on to the live server, at `http://localhost:3031`  | set `LIVE_SERVER_URL`                                    |
| Configuration | `/config.json` | answered by the dev server                                | set `ABOUT_LINK_1_LABEL` and `ABOUT_LINK_1_URL`, up to 4 |

So the browser needs no second address and no CORS headers. `bun run build` builds the web app into `dist/`; whatever serves that must do the same with all three paths, `/socket.io` as a WebSocket. The demo's [web image](#running-the-demo-in-containers) does.

The configuration is what the web app is told at run time: the links of its "About" dialog. The web app knows nothing of what they lead to. Each link is a pair of variables, what it says and where it leads, and there may be up to four, shown in their order:

```sh
ABOUT_LINK_1_LABEL="Source code" ABOUT_LINK_1_URL=https://git.example.com/demo bun run dev
```

A pair that is not set, or only half set, gives no link, so by default the dialog has none. An address must begin with `http://` or `https://`. A label cannot contain a double quote in the containers, where it would spoil the file and leave the dialog without links.

### Running the Demo in Containers

The demo also runs as three containers, with [Docker](https://www.docker.com) and no Bun installed. In `examples/virtual-infrastructure/`:

```sh
docker compose up --build
```

Open `http://localhost:3032`. Stop it with Ctrl+C.

| Container      | Runs                                           | Reached from outside           |
| -------------- | ---------------------------------------------- | ------------------------------ |
| `data-service` | the data service, on port 3030                 | no                             |
| `live-server`  | the live server, on port 3031                  | no                             |
| `web`          | [Caddy](https://caddyserver.com), on port 3032 | yes: it is the demo's one door |

The `web` container serves the built web app and does what the dev server does: it passes `/socket.io` on to the data service and `/command` on to the live server, and answers `/config.json`. It also passes `/health` on to the live server, so one address tells whether the whole demo works:

```sh
curl http://localhost:3032/health
```

The records are kept in memory (a `tmpfs`), so the demo starts from nothing each time its containers are created. To start over while it runs:

```sh
docker compose up -d --force-recreate
```

A page that is open meanwhile says that the connection is lost, then shows the new system.

Set these where `docker compose` runs, in the environment or in an `.env` file beside `compose.yaml` (Git ignores it):

| Variable                                          | What it does                                                                                               | When not set           |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ---------------------- |
| `WEB_PORT`                                        | the port the demo is opened on                                                                             | 3032                   |
| `DATA_SERVICE_WRITE_TOKEN`                        | makes the records read-only from outside: any value, given to the data service and the live server alike   | every client may write |
| `HEALTH_ALLOW_ORIGIN`                             | the origin of a page elsewhere that may read `/health` from a browser, such as `https://demos.example.com` | no such page           |
| `ABOUT_LINK_1_LABEL`, `ABOUT_LINK_1_URL`, up to 4 | a link in the "About" dialog: what it says and where it leads ([above](#running-the-demo))                 | no link                |

Each image is built from the repository's root by the `Dockerfile` in its part's folder, which is what `compose.yaml` does:

```sh
docker build -f examples/virtual-infrastructure/web/Dockerfile -t virtual-infrastructure-web .
```

### Publishing the Demo's Images

A tag named `virtual-infrastructure-v<version>` publishes the three images to the GitHub Container Registry, built for AMD64 and ARM64:

```sh
git tag virtual-infrastructure-v0.1.0
git push origin virtual-infrastructure-v0.1.0
```

The workflow in `.github/workflows/demo-images.yml` pushes `ghcr.io/<owner>/virtual-infrastructure-<part>` under the version (`0.1.0`) and under `latest`, where `<owner>` is the account the repository belongs to and `<part>` is `data-service`, `live-server` or `web`.

A package is private when it is first pushed: make it public in its settings on GitHub before others can pull it.

### No Build Step

The packages export their TypeScript source: each `package.json` points its `exports` at files in `src/`, and nothing compiles them to JavaScript. Bun strips the types as it loads a file, so a change in one package is seen at once by the tests and by the demo, with no `dist/` folder to rebuild.

What follows from this:

- **`bun test` does not check types.** Bun removes them without checking them, so code with type errors can pass its tests. Run `bun run typecheck` as well.
- **The packages run under Bun or through a bundler, not under plain Node.js.** Node.js does not strip types from files under `node_modules`. A web app built with a bundler such as Vite is unaffected.
- **A package needs a build before it is published.** The build emits JavaScript and `.d.ts` files, and `exports` then points at those. This applies first to `micro-fsm` and `feathers-connect`, when they move to repositories of their own. It changes the package's `package.json`, not its source.

## Testing

Every change brings its tests ([ADR 012](decisions/012-bun-workspace-and-demo.md)). A test file sits beside the code it tests and is named `<file>.test.ts`.

### Time in Tests

A test of behavior over time does not wait for real time: it gives the code a `FakeClock` ([Architecture](architecture.md#time)) and moves it.

```ts
const clock = new FakeClock()
const debounced = debouncePatch(write, 100, { clock })

debounced.patch({ count: 1 })
await clock.advance(100) // runs every timer due within 100 ms, each at its own time
```

- `advance(ms)` moves the time on and runs the timers that come due. After each timer it lets the promises the timer began come to rest, so a timer set from there runs too.
- `advanceToNext()` moves to the timer due first, however far off it is.

The demo's live server tests get the clock from `createContext()` and `bootSystem()` in its `test-support.ts`, and durations there are the real ones: a search command runs for 2,000 ms of the clock. Two helpers wait for a condition:

| Helper                                  | For                                                                                                                                                      |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `advanceUntil(clock, condition)`        | a system on in-memory record sources: moves the clock from timer to timer until the condition holds                                                      |
| `advanceUntilArrived(clock, condition)` | a system that reaches a real data service: the same, with a moment of real time after each timer for what was sent to arrive, and a timeout in real time |

Sleeping for real (`Bun.sleep`, `setTimeout`) to let simulated time pass makes a test fail when its process stalls. Real time is only for what really takes it: a network, or the `systemClock` itself.

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

- **A write that failed.** A write that the data service does not answer in time is rejected, as one made while the connection is away for longer than that ([ADR 017](decisions/017-resync-on-reconnect.md)). A `debouncePatch` reports the failure and drops the patch, so the fields stay as they were in the data service until their owner writes them again. Whether the patch is kept for the next write, or the owner writes its fields again when the connection is back, is not designed ([issue 1](https://github.com/dmccuskey/live-system/issues/1)).
- **Trying a failed resync again.** A resync that fails is tried again only at the next reconnect ([ADR 017](decisions/017-resync-on-reconnect.md)).
- **Other record sources** beside Feathers and the in-memory one, and with the first backend that does not create its own IDs, how IDs are assigned ([ADR 006](decisions/006-record-source-boundary.md)).
- **Authentication and permissions.** Out of scope for now ([ADR 013](decisions/013-server-web-symmetry.md)).
- **Typed payloads per route.** A command's data typed by its route ([ADR 009](decisions/009-commands-events-crud.md)).
- **A shared scheduling helper.** Only once several owners need the same thing ([ADR 015](decisions/015-timers-belong-to-owner.md)).
- **Generated protocol types**, from a schema or an API description ([ADR 010](decisions/010-applications-own-protocol.md)).
- **A devtools package** for inspecting a running system.
- **More examples.** A factory or warehouse simulator, and an application built in its own repository on the published packages.
