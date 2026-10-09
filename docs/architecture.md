# LiveSystem Architecture and Design

## Overview

**LiveSystem is a lightweight framework for building applications whose state and behavior remain alive over time.**

It provides simple primitives for lifecycle management, managers, live objects, commands, events, record sources, and reactive state. The goal is to make it easy to build systems that continuously operate, respond to changing conditions, and coordinate long-lived objects rather than treating every interaction as an isolated request.

The central idea is:

> **The application is a living system, not merely a collection of request handlers.**

LiveSystem is intentionally small. It does not attempt to provide a complete application framework, distributed actor system, workflow engine, or database abstraction. Instead, it provides a small set of composable primitives from which those applications can be built.

## What It Is For

LiveSystem is designed for soft-realtime applications: systems whose state changes over time, whether or not someone is watching. It is also useful for building realistic prototypes, which emulate the behavior of the systems behind an interface.

Both need objects that hold state, act over time, and report changes as they happen. A mock API can return plausible data when asked, but it cannot start a process later, run it for a while, or report a failure while the user is elsewhere. That kind of behavior calls for a live object, with its own state and timers.

These are the two uses known so far, and others may fit the same architecture. They give a live object one of two [roles](#roles): processor or simulator.

The [demo](#demo-application) is a small prototype of this kind: its virtual users and virtual servers are live objects that emulate people and machines.

## Design Philosophy

LiveSystem is based on several principles.

### Long-Lived Runtime

The application starts, initializes its components, enters a running state, and remains alive while its objects perform work and respond to events.

### Managers Own Existence

Managers are responsible for collections of related objects and control their creation and destruction.

> **The Manager owns the existence of an object. The Object owns what happens during its existence.**

### Objects Own Behavior

A live object is more than a record. It has identity, state, behavior, and potentially its own timers, subscriptions, and lifecycle.

### Commands Request Actions

Commands express something the application wants done.

### Events Report What Happened

Events communicate state changes and completed actions without requiring the receiver to be directly coupled to the producer.

### Records Describe State

Records represent persistent or transportable data. They are not necessarily the runtime objects themselves.

### Technology Stays at the Edges

LiveSystem should not require a particular database, transport, or persistence technology.

For example, Feathers can be used as a record source implementation, but it should not define the architecture. The one technology LiveSystem does fix is the local store: Vue's reactivity and Pinia, used as libraries with no UI (see [Reactive State](#reactive-state)).

Decisions: [ADR 001](decisions/001-long-lived-managed-objects.md), [ADR 011](decisions/011-plain-typescript-vue-reactivity.md).

## Architectural Model

At a high level:

```text
                         LiveSystem
                             │
              ┌──────────────┼──────────────┐
              │              │              │
         Lifecycle        Router         Event Bus
              │              │              │
              └──────────────┼──────────────┘
                             │
                       Manager Registry
                             │
              ┌──────────────┼──────────────┐
              │              │              │
          Managers       Managers       Managers
              │              │              │
          Live Objects   Live Objects   Live Objects
              │
       Record Source / State
```

The runtime provides the environment in which managers and objects remain alive.

A typical application therefore looks conceptually like:

```text
Application
│
└── LiveSystem
    │
    ├── Lifecycle
    ├── Router
    ├── Event Bus
    └── Managers
        │
        ├── UserManager
        │   ├── User
        │   ├── User
        │   └── User
        │
        ├── ServerManager
        │   ├── Server
        │   ├── Server
        │   └── Server
        │
        └── ...
```

## The LiveSystem Object

An application creates one instance of `LiveSystem`, adds its managers, and boots it. The demo's live server does it so, trimmed to what shows the pattern ([the whole of it](../examples/virtual-infrastructure/live-server/src/app.ts)):

```ts
const system = new LiveSystem<DemoContext>({
    context: { clock, events, pinia, random },
    router,
    connect: () => connection.connect(),
    disconnect: () => connection.disconnect(),
})

system.addManager(context => new UserManager(context, connection.recordSource(SERVICES.users), useUserStore(pinia)))
system.addManager(
    context =>
        new ServerManager(
            context,
            connection.recordSource(SERVICES.servers),
            useServerStore(pinia),
            connection.recordSource(SERVICES.managers),
        ),
)
// and likewise the ManagerRecords

await system.boot()
```

The system is given the application's own parts: the context that every manager shares, and optionally the router its managers' commands are registered with, how to connect to the infrastructure it depends on and how to disconnect from it. A server passes a router; a web app has none. LiveSystem itself opens no connection, so it assumes no technology.

`boot()` takes the system through its whole lifecycle, from `CREATED` to `RUNNING`; [LifecycleRunner](#lifecyclerunner) shows how. If a step fails, what had started is stopped and disconnected, and `boot()` rejects with the error.

`shutdown()` is the counterpart. It stops the running system and releases what it holds:

```ts
await system.shutdown()
```

Called during a boot, it waits for the boot to settle and then stops. Called again, it does nothing.

`addManager()` takes a function that creates the manager, and returns the manager. The system calls the function with the one context that every manager shares, so the application does not pass shared parts around itself. Managers are added before `boot()`. `addManager()` then does the rest:

```text
system.addManager(factory)
    │
    ├── manager = factory(context)
    ├── add the manager to the registry
    └── register the manager's routes with the router
```

What differs from manager to manager, such as its record source, is passed by the function that creates it. [Managers](#managers) shows what a manager receives.

The instance is the one place that holds the parts of the running system:

```text
system (a LiveSystem)
│
├── infrastructure connections
├── Router
├── Event Bus (when the application uses one)
├── Manager Registry
│    ├── UserManager
│    ├── ServerManager
│    └── ...
│
└── LifecycleRunner
```

`LiveSystem` is reusable: it knows nothing about the application's domain. What makes one application different from another is the managers added to it.

The system owns infrastructure readiness. It connects to what the application depends on before any manager is initialized, so a manager can rely on one rule:

> **When `init()` is called, the system's infrastructure is ready.**

Startup is split into three small responsibilities, described in the next two sections:

> **LiveSystem owns the lifecycle. LifecycleRunner orchestrates it. The state machine enforces it.**

Decisions: [ADR 004](decisions/004-lifecycle-runner-and-state-machine.md), [ADR 014](decisions/014-failure-and-shutdown.md).

## Lifecycle

LiveSystem applications have an explicit lifecycle.

A conceptual lifecycle is:

```text
CREATED
   │
   ▼
READY
   │
   ▼
INITIALIZED
   │
   ▼
STARTED
   │
   ▼
RUNNING
   │
   ▼
STOPPED
```

The lifecycle is enforced by a small state machine, `micro-fsm`, but the state machine is an implementation detail of the lifecycle system.

### READY

Infrastructure required by the application becomes available.

Examples:

- database connection established
- Feathers connection established
- configuration loaded
- required external services connected

The important distinction is that readiness should be based on an actual readiness condition rather than an arbitrary startup delay.

### INITIALIZED

Managers have loaded their own records and rebuilt their live objects from them.

Nothing watches or acts yet: every store is being filled.

### STARTED

Managers and live objects watch what is within the system.

Examples:

- event subscriptions installed
- watches on the stores installed

Every store is loaded by now, so whatever a manager watches is there to be found.

### RUNNING

The application is actively operating: managers and live objects act, and communicate with the outside world.

Examples:

- timers started
- background activity enabled
- first commands sent
- connections to outside services in use

At this point the system is expected to remain alive and respond to commands, events, timers, and changes in state.

What a manager does in each phase is under [Each Phase Has Its Work](#each-phase-has-its-work).

### STOPPED

The application shuts down its active behavior and releases resources.

Managers should remove event listeners, stop timers, destroy live objects, and release other resources they own.

Decision: [ADR 003](decisions/003-explicit-async-lifecycle.md).

## LifecycleRunner

Lifecycle orchestration belongs to a dedicated lifecycle runner rather than being spread throughout the application.

Conceptually:

```text
LiveSystem
    │
    └── LifecycleRunner
            │
            └── StateMachine
```

`system.boot()` hands the startup to the runner. The runner's `run()` makes each transition in order, and each transition calls back into the system to do that state's work:

```text
system.boot()
    │
    ▼
lifecycle.run()
    │
    ├── transition('ready')        → system.connect()
    ├── transition('initialized')  → system.initManagers()
    ├── transition('started')      → system.startManagers()
    └── transition('running')      → system.runManagers()
```

`CREATED` is the state the system is in before `boot()` is called, while the managers are being created and added, so the runner makes no transition into it.

Inside `run()`:

```ts
await lifecycle.transition('ready')
await lifecycle.transition('initialized')
await lifecycle.transition('started')
await lifecycle.transition('running')
```

Each transition waits for its associated work to complete before advancing.

For example:

```ts
initialized: {
    from: 'ready',

    enter: async () => {
        await system.initManagers()
    }
}
```

An asynchronous lifecycle operation therefore naturally provides synchronization.

Shutdown takes the same path in the other direction:

```text
system.shutdown()
    │
    ▼
lifecycle.transition('stopped')  → system.stopManagers()
```

Managers are stopped in the reverse of the order they were added, so a manager that depends on one added earlier is stopped first. Only a manager whose `init()` was begun is stopped, and one that fails to stop does not keep the others from stopping: the errors are reported once all have been stopped. The system then closes its infrastructure connections.

If initialization fails, the transition fails and the system does not silently advance to the next state.

Decision: [ADR 004](decisions/004-lifecycle-runner-and-state-machine.md).

## Managers

Managers organize related application behavior.

A manager may:

- own a collection of records
- create and destroy live objects
- declare the commands it handles
- subscribe to events
- coordinate domain behavior
- hold the record source for one kind of record (for example, one Feathers service)
- perform lifecycle work
- monitor system conditions

Managers should inherit **capabilities**, not technologies.

A basic hierarchy might be:

```text
BaseManager
    │
    ├── DataManager<T>
    │       ├── a manager that mirrors records
    │       │
    │       └── LiveObjectManager<T, O>
    │               ├── UserManager
    │               ├── ServerManager
    │               └── ...
    │
    └── SpecializedManager
```

`BaseManager` should remain intentionally small.

```ts
abstract class BaseManager<C = unknown> {
    constructor(protected readonly context: C) {}

    routes(): Routes {
        return {}
    }

    async init(): Promise<void> {}
    async start(): Promise<void> {}
    async run(): Promise<void> {}
    async stop(): Promise<void> {}
}
```

### Each Phase Has Its Work

Each phase has its work, and keeping to it is what makes the order of the managers irrelevant:

| Phase     | What a manager and its live objects do                                                  |
| --------- | --------------------------------------------------------------------------------------- |
| `init()`  | read their own records from the data store and rebuild their objects from them          |
| `start()` | begin to watch what is within the system: the event bus, the stores                     |
| `run()`   | begin to act, and to communicate with the outside world, for example a stock market API |

Every manager has finished a phase before any begins the next. So a manager that announces something in `run()` is heard by every manager that began to listen in `start()`, whichever was added first. In the same way, a manager that watches another's store in `start()` finds its records there, because every manager loaded its own in `init()`.

The order the managers are added in should therefore never matter. A comment that explains why one manager is added before another is a sign that something is done in the wrong phase.

For example, in the [demo](architecture-demo.md#manager-records) the `ServerManager` sees to its own record in `init()`, begins to watch the manager store in `start()` and begins to sample the load in `run()`, and the virtual users send their first commands in `run()`.

### The Context

A manager receives as little as possible. The context holds only what every manager shares. Its type is the application's own, since the events are the application's choice. The demo's:

```ts
interface DemoContext {
    clock: Clock
    events: EventBus<DemoEvents>
    pinia: Pinia
    random: () => number
}
```

The demo's managers take that type (`LiveObjectManager<UserRecord, VirtualUser, DemoContext>`), and its system is a `LiveSystem<DemoContext>`.

The event bus is passed in rather than reached for globally, so a test can give a manager its own. The Pinia instance holds the application's local reactive state, one store per kind of record. The [clock](#time) and the source of random numbers are the demo's own additions, there for the same reason as the bus: a test gives its own.

### Routes

The router is not in the context. A manager declares the commands it handles, and the system registers them when the manager is added:

```ts
class ServerManager extends LiveObjectManager<ServerRecord, VirtualServer, DemoContext> {
    override routes(): Routes {
        return {
            // 'servers/add' and 'servers/:id/remove'
            [SERVER_ROUTES.add]: this.addServer,
            [SERVER_ROUTES.remove]: this.removeServer,
            // 'managers/:key/update' with this manager's key: 'managers/servers/update'
            [fillRoute(MANAGER_ROUTES.update, { key: MANAGER_KEYS.servers })]: this.updateSettings,
        }
    }
}
```

The patterns are constants of the demo's [protocol](#protocols), which its web app builds its commands from as well.

`routes()` returns plain functions, which carry no reference to the manager. The system adds that reference when it registers them: each route in the router records the manager that owns it, and the handler is called with that manager as `this`.

```text
route
├── pattern    'servers/:id/remove'
├── handler    removeServer
└── manager    the ServerManager that declared it
```

Because each route knows its manager, removing a manager also removes its routes. `shutdown()` removes the routes of every manager.

A handler receives the route's parameters and the command's data. What it returns becomes the response's `result`:

```ts
async addServer(): Promise<AddServerResult> {
    // what it resolves with, { id }, is the response's result
}

async removeServer(params: RouteParams): Promise<void> {
    // params.id is '42' for the route 'servers/42/remove'
}

async updateSettings(params: RouteParams, data: SettingsUpdate): Promise<void> {
    // data is { scalingMode: 'manual' } for a command with that as its data
}
```

The router lives in `live-system/server`, and `core` knows it only as a `RouteRegistry`, an interface with `register()` and `removeManager()`.

### Managers of Records

A manager that works with records also receives the record source for its one kind of record, and the store it mirrors them into:

```ts
abstract class DataManager<T extends { id: string }, C = unknown> extends BaseManager<C> {
    constructor(
        context: C,
        protected readonly source: RecordSource<T>,
        protected readonly records: RecordStore<T>,
    ) {
        super(context)
    }

    protected recordAdded(record: T): void {}
    protected recordChanged(record: T, previous: T): void {}
    protected recordRemoved(record: T): void {}
    protected resyncFailed(error: unknown): void {}
}
```

A `DataManager` loads its records during `init()` and keeps the store current from the record source's change events. The three record hooks tell a subclass what happened, each after the store has changed. To change a record, a manager calls its record source (`this.source.patch(id, data)`); the store changes when the event comes back.

When its record source reports that it was lost and is reached again, a `DataManager` fetches every record again and applies only what differs: a record added, changed or removed meanwhile gets its hook, and a record that is equal keeps its object in the store, so nothing watching it reacts. If that sync fails, the store keeps what it holds and `resyncFailed` is called, which logs with `console.error` by default ([ADR 017](decisions/017-resync-on-reconnect.md)).

A manager whose records each have a live object extends `LiveObjectManager<T, O>`, which is a `DataManager<T>` that also creates, starts and destroys the objects (see [Object Ownership](#object-ownership)). A web app's managers only mirror records, so they extend `DataManager<T>`.

Managers should not assume that the application uses Feathers, SQLite, HTTP, or any other particular technology for its data or transport.

### A Record per Manager

Some data describes a manager, not a thing the application has many of: what a user has set for it, and what it reports of itself. That data is the manager's own record, a **manager record**, and it follows these rules:

- **The manager records share one service and one store.** There is a record per manager that has one, even while only one manager does, so the pattern is easy to see and to extend.
- **Each record carries the key of the manager it belongs to**, in a `key` property, and is found by it.
- **Each manager's record has its own type.** The records of one service are not alike: the type is told by the `key`.
- **The `id` is the data service's to give**, as for every other record. A meaningful name is a property of its own, never the ID.
- **A manager is the only writer of its own record.** What a user sets arrives as a command on the managers' route, `managers/:key/update`, which each manager takes with its own key, and the manager writes it. The command carries only the settings that change: one left out stays as it is. What the manager reports, it writes as it changes. This is the same split as in any record a live object writes: fields set from outside, and fields the owner produces.
- **What is set takes effect when it comes back in the store.** The manager watches the store for its record, as for any change. What it reports itself it does not read back.
- **The manager creates its record in `init()`** when there is none, from its defaults in the protocol. For this it asks its source, not the store.
- **The defaults are a table in the protocol**, by key. A manager whose record goes missing from the store falls back on them: someone may delete it by hand during development.
- **One manager mirrors the service into the store** and writes no record, since a store has one manager that keeps it a projection of the data service.

```ts
// protocol/managers/managers.record.ts
interface ManagerRecords {
    servers: ServerManagerRecord
}

type ManagerRecord = ManagerRecords[keyof ManagerRecords]

// protocol/managers/managers.constants.ts
const DEFAULT_MANAGER_RECORDS: { [K in keyof ManagerRecords]: Omit<ManagerRecords[K], 'id'> } = {
    servers: {
        key: 'servers',
        scalingMode: 'automatic',
        maxUtilization: 0.75,
        queueLength: 0,
        waitingForRoom: 0,
        utilization: 0,
        throughput: 0,
        requested: 0,
    },
}
```

The table is typed by its keys, so a new key without defaults is a type error and a record cannot be forgotten.

The demo's `ServerManager` has such a record ([Demo Architecture](architecture-demo.md#manager-records)).

Decision: [ADR 005](decisions/005-manager-capabilities.md).

## Live Objects

A LiveSystem object represents something that exists continuously within the running system.

A live object generally has:

```text
identity
state
behavior
lifecycle
```

Examples include:

- users
- servers
- machines
- robots
- jobs
- devices
- workflows
- sessions

A record holds the object's state, including the state that changes as the system runs. In the [demo](architecture-demo.md), a user's record holds how it behaves, which is fixed, and how frustrated and how well served it is, which change:

```ts
interface UserRecord {
    id: string
    name: string
    commandsPerMinute: number
    commandMix: CommandMix
    frustration: number
    served: number
}
```

The corresponding live object keeps the record's ID, not the record. It reads the record from the store by that ID, where it is always current, and writes through the record source. It additionally holds what cannot be stored:

```text
timers
subscriptions
operations in progress
behavior
```

This distinction is important:

```text
Record
  = state, as stored and displayed

Live Object
  = record + behavior + existence
```

A manager creates and destroys the live object.

The object manages what happens while it exists.

### The Object and Its Record

A change to a record reaches its live object through the store, never through its manager: the manager does not pass a changed record on. How the object treats a field depends on who writes it:

| The field is written by                         | The object                                                                                                     |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| the object itself (a user's frustration)        | keeps the value in memory, where it is current, writes it through the record source, and does not read it back |
| someone else (a user's rate, were it to change) | reads it from the store when it needs it, or watches it there, and keeps no copy                               |

The object does not read back what it writes, because the store may be a moment behind it: a write waits in [`debouncePatch`](#reactive-state), or is on its way to the data service and back. The one time it reads its own field is in `init()`, to learn what an earlier run left in the record.

### An Example

The demo's `VirtualUser` is the live object of a user record. It sends commands at its record's rate, hears what becomes of them, and keeps its frustration. Here it is, trimmed to what shows the pattern ([the whole of it](../examples/virtual-infrastructure/live-server/src/virtual-user.ts)):

```ts
class VirtualUser extends LiveObject {
    readonly id: string
    #records: RecordStore<UserRecord>
    #context: DemoContext
    #frustration = 0
    #cancelTimer: CancelTimer | undefined
    #subscriptions: Unsubscribe[] = []
    #write: DebouncedPatch<UserRecord>

    constructor(
        id: string,
        records: RecordStore<UserRecord>,
        source: RecordSource<UserRecord>,
        context: DemoContext,
        options?: LiveObjectOptions,
    ) {
        super(options)
        this.id = id
        this.#records = records
        this.#context = context
        this.#write = debouncePatch<UserRecord>(data => source.patch(this.id, data), WRITE_DELAY, {
            clock: context.clock,
        })
    }

    // No command outlives the live server, so what the record says of an earlier run is cleared
    override async init() {
        if ((this.#record?.frustration ?? 0) !== 0) this.#write.patch({ frustration: 0 })

        await this.#write.flush()
    }

    // Begins to listen for what becomes of its commands
    override start() {
        this.#subscriptions.push(
            this.#context.events.on('commandRefused', event => {
                if (event.userId === this.id) this.#refused(event)
            }),
            // and likewise 'commandQueued', 'commandStarted' and 'commandFinished'
        )
    }

    // Begins to act
    override run() {
        this.#schedule()
    }

    protected override release() {
        this.#cancelTimer?.()
        this.#cancelTimer = undefined
        this.#write.cancel()

        for (const unsubscribe of this.#subscriptions.splice(0)) unsubscribe()
    }

    // The record as the store has it now. There is none once the user has been removed.
    get #record() {
        return this.#records.get(this.id)
    }

    // Waits a random time, the mean of which gives the user's rate, then sends a command and waits again
    #schedule() {
        const rate = this.#record?.commandsPerMinute ?? 0

        if (this.isDestroyed || !(rate > 0)) return

        const mean = 60_000 / rate
        const delay = -Math.log(1 - this.#context.random()) * mean

        this.#cancelTimer = this.#context.clock.after(delay, () => {
            this.#send()
            this.#schedule()
        })
    }

    #send() {
        const record = this.#record

        if (!record) return

        const type = pickCommandType(record.commandMix, this.#context.random())

        this.#context.events.emit('commandRequested', { commandId: crypto.randomUUID(), userId: this.id, type })
    }

    #refused(event: CommandRefusedEvent) {
        if (event.reason === 'queue_full') this.#set(afterRefused(this.#frustration))
    }

    #set(frustration: number) {
        if (frustration === this.#frustration) return

        this.#frustration = frustration
        this.#write.patch({ frustration })
    }
}
```

Each of the four things a live object has is there:

| has       | in `VirtualUser`                                                                                                |
| --------- | --------------------------------------------------------------------------------------------------------------- |
| identity  | `id`, its record's ID                                                                                           |
| state     | its record, read from the store, and its frustration, which it keeps and writes back with `debouncePatch`       |
| behavior  | `#schedule()` and `#send()`: nothing tells it to send a command                                                 |
| lifecycle | `init()`, `start()` and `run()`, each with [its own work](#each-phase-has-its-work), and `release()` at the end |

It knows nothing of the servers. It asks for a command to be run with an event on the [event bus](#the-event-bus), and hears of the outcome the same way. Its timer is the context's [clock](#time), so a test can move the time by hand.

### Time

A live object that acts over time (it waits, it repeats, it measures how long something took) may use `setTimeout()` and `Date.now()` directly. Tests of that behavior are then at the mercy of real time: they have to wait for it, and they fail when their process stalls. So `core` offers a `Clock` that an application can use instead, which a test can replace and move by hand:

```ts
interface Clock {
    now(): number // milliseconds: only the difference between two readings means anything
    after(delay: number, fn: () => void): CancelTimer
    every(interval: number, fn: () => void): CancelTimer
}
```

Each timer returns the function that cancels it, which its owner calls at the end of its own life, as with a subscription. `core` has three clocks:

| Clock                       | Is                                                                                                |
| --------------------------- | ------------------------------------------------------------------------------------------------- |
| `systemClock`               | real time                                                                                         |
| `scaledClock(clock, scale)` | another clock with every delay multiplied by `scale`, for a simulation that runs faster or slower |
| `FakeClock`                 | a clock for tests: time stands still until the test moves it                                      |

The clock is opt-in, and it is there for the tests: nothing in LiveSystem asks for one or passes one around. An application that wants one puts it in its context, where its managers and live objects find it. With a `FakeClock` there, a test of behavior over time waits for nothing and does not depend on how fast its process runs ([Development](development.md#time-in-tests)).

### Roles

"Live object" says what the thing is. What it is for is usually one of two roles:

| role          | example                                      | what it does                                               |
| ------------- | -------------------------------------------- | ---------------------------------------------------------- |
| **Processor** | a chart in a trading system                  | watches data and derives more data from it as it changes   |
| **Simulator** | the demo's `VirtualServer` and `VirtualUser` | behaves like a system or a person that is not really there |

The framework treats both alike: the role is a way to think about an object, not a class to extend. A prototype is mostly simulators, and a soft-realtime application mostly processors.

Decision: [ADR 016](decisions/016-records-hold-live-state.md), on what a record holds.

## Object Ownership

Object ownership follows a simple rule:

> **The Manager owns the existence of objects. The Object owns its own behavior.**

`LiveObjectManager` does the owning. It keeps the objects by their record's ID, creates one when a record appears, and destroys it when the record is removed or the manager stops. The domain manager says only how an object is made:

```ts
class UserManager extends LiveObjectManager<UserRecord, VirtualUser, DemoContext> {
    protected override createObject(record: UserRecord, options: LiveObjectOptions) {
        return new VirtualUser(record.id, this.records, this.source, this.context, options)
    }
}
```

`createObject` only constructs. The `options` carry the `onDestroyed` callback through which the manager hears of the object's end, and the object passes them to `LiveObject`. The manager reaches one of its objects with `getObject(id)`, and all of them through `objects`.

An object starts in step with its manager. `LiveObject` has `init()`, `start()` and `run()`, which do nothing unless overridden:

- **During startup**, the records are loaded in the manager's `init()`, an object is created for each, and each object's `init()` is awaited. The manager's `start()` awaits each object's `start()`, and its `run()` each object's `run()`. So every object of every manager is initialized before any is started, and no object acts on its own before the system is running.
- **While the system runs**, the object for a new record is taken through `init()`, `start()` and `run()`, one after the other.

An object whose step fails is destroyed and reported to the manager's `objectFailed(object, error)`, which logs by default. The other objects are not affected.

The object performs its own cleanup. `LiveObject`, the base class, provides `destroy()`: it does nothing the second time it is called, calls the object's `release()`, and then tells the owner through `onDestroyed`. The object says what there is to release:

```ts
class VirtualUser extends LiveObject {
    protected override release() {
        this.#cancelTimer?.() // its timer
        this.#write.cancel() // its pending write
        for (const unsubscribe of this.#subscriptions.splice(0)) unsubscribe() // its listeners
    }
}
```

Most of the work in an application is in its live objects: the base class only settles how one ends.

This allows a simple mechanism to control basic parent-child ownership.

Events remain useful for communication between independent parts of the system.

Decision: [ADR 002](decisions/002-managers-own-existence.md).

## Data and Record Sources

LiveSystem separates application behavior from persistence and transport.

A record source provides access to one kind of record. It is not the whole data store or the connection to it: with Feathers, a record source wraps a single service, and every record source shares the one connection.

```ts
interface RecordSource<T extends { id: string }> {
    find(): Promise<T[]>
    get(id: string): Promise<T>
    isNotFound(error: unknown): boolean

    create(data: Omit<T, 'id'> & { id?: string }): Promise<T>
    update(id: string, data: T): Promise<T>
    patch(id: string, data: Partial<T>): Promise<T>
    remove(id: string): Promise<T>

    onCreated(listener: (record: T) => void): Unsubscribe
    onUpdated(listener: (record: T) => void): Unsubscribe
    onPatched(listener: (record: T) => void): Unsubscribe
    onRemoved(listener: (record: T) => void): Unsubscribe

    onReconnected(listener: () => void): Unsubscribe
}
```

A record has a string `id`. A record to create may leave it out, and the source then assigns one, as Feathers does.

`get` rejects when the record does not exist, and `isNotFound(error)` says whether what a call rejected with means that. Any other failure, such as a lost connection, says nothing of the record.

`onReconnected` is called when the source was lost and is reached again, never for the first connection. Change events may have been missed meanwhile, so whatever loaded records from the source fetches them again.

The implementation can vary:

```text
RecordSource
    │
    ├── MemoryRecordSource
    ├── SQLiteRecordSource
    ├── FeathersRecordSource
    └── ...
```

`core` provides `MemoryRecordSource`, which keeps its records in memory and emits the same change events, for testing a manager without a data service. Its `disconnect()` and `reconnect()` stand in for a lost connection: changes made between the two emit no event.

The `feathers-connect` package provides `FeathersRecordSource`, over one service of a `FeathersConnection` ([its README](../packages/feathers-connect/README.md)).

This allows the application architecture to remain independent of its storage technology.

Decisions: [ADR 006](decisions/006-record-source-boundary.md), [ADR 007](decisions/007-data-service-source-of-truth.md), [ADR 008](decisions/008-startup-sync.md), [ADR 017](decisions/017-resync-on-reconnect.md).

## Reactive State

Reactive state is how data changes are communicated inside an application. It is not the fundamental architecture of LiveSystem, which remains ordinary TypeScript: classes, inheritance, and lifecycle.

Vue 3's reactivity is used as a library, separately from Vue's components:

```ts
reactive()
ref()
computed()
watch()
```

These functions need no UI. They are used on both sides of an application, for different purposes:

```text
                 Vue reactivity
        reactive, ref, computed, watch
                       │
          ┌────────────┴────────────┐
          │                         │
       Server                    Web app
          │                         │
   reactive state            reactive state
          │                         │
   managers and              managers react
   live objects react               │
          │                         │
        no UI                Vue components
                                    │
                                   UI
```

On the server, reactivity communicates data changes: a manager or a live object watches reactive state and acts when it changes. There are no components and nothing is rendered.

In a web application, Vue is used in the standard way: the same reactive state also drives components, which render the UI.

The store is [Pinia](https://pinia.vuejs.org), on the server as on the web: Pinia needs no Vue app. Each kind of record has a store of its own, defined in one line:

```ts
const useServerStore = defineRecordStore<ServerRecord>(SERVICES.servers)

const servers = useServerStore(pinia)

servers.records // every record, by ID
servers.get('42') // one record, or undefined
```

Only the `DataManager` for those records writes to the store. Everything else reads, and what reads inside a `computed` or a `watch` reacts when the record is replaced. A record is replaced whole when it changes, never changed in place.

An object whose record changes faster than is worth writing can collect its updates with `debouncePatch`, which merges them and writes once after a quiet delay. It is opt-in: by default an update is written as it happens. Its delay runs on real time, or on the [clock](#time) it is given.

When Feathers is used, a useful model is:

> **The data service is the source of truth. Reactive state is a materialized view of that data.**

This holds on both sides. For example:

```text
Feathers
   ↓
database mutation
   ↓
CRUD event
   ↓
reactive projection
   ↓
   ├── server:  managers and live objects react
   └── web app: managers react, and the Vue UI updates
```

### Sharing Data: the Store First

The store is how an application shares its data. It is there so that every part can react to any of the data.

- **Every store is a projection of the data service.** A manager writes to the data service through its record source. The change comes back as an event of the service, and the manager writes it into the store. A manager never changes the store on its own.
- **A part that needs data another part owns watches the store.** It does not ask the manager that owns the data, and it needs no event for it. An event on the bus that repeats what the store already says is unnecessary.
- **A watch on the store may be synchronous** (`flush: 'sync'`), so that a change is in force as soon as the store has it.

```ts
// in the ServerManager: a setting takes effect when it comes back in the store
override async start() {
    await super.start()

    const managers = useManagerStore(this.context.pinia)

    this.#subscriptions.push(
        watch(
            () => Object.values(managers.records).find(record => record.key === MANAGER_KEYS.servers),
            record => this.#settingsChanged(record),
            { immediate: true, flush: 'sync' },
        ),
    )
}
```

The watch begins in `start()`, when every store is loaded ([Each Phase Has Its Work](#each-phase-has-its-work)).

What does not fit the store goes over the event bus, which is for "special" communication ([Event Sources](#event-sources)).

Decisions: [ADR 011](decisions/011-plain-typescript-vue-reactivity.md), [ADR 007](decisions/007-data-service-source-of-truth.md).

## Commands

Commands request actions.

They are distinct from CRUD records.

A command might be:

```text
server/42/restart
pipeline/17/run
user/12/suspend
```

with arguments carried separately:

```ts
interface Command<T = unknown> {
    route: string
    data: T
}
```

For example:

```ts
router.handle({
    route: 'repo/42/push',

    data: {
        branch: 'feature/foo',
        force: false,
    },
})
```

The command router is therefore not necessarily a REST router.

It is a **command dispatcher**.

HTTP POST, WebSocket messages, internal method calls, or other transports may be adapters around the command system.

### Who Sends Commands

Routes are for what comes in from outside: they are how an application's web apps make changes to the system, for example a user who creates a watchlist in a trading application. As a rule of thumb, nothing inside the system sends a command, and nothing calls a manager directly.

- **A manager does not reach another manager through a route.** Building a command to call what runs in the same process is cumbersome, and a route is not written for it.
- **A manager does not call another manager's methods.** Nothing prevents it, but in general it should not happen, and a manager is given no reference to the others: the [context](#the-context) holds the event bus and the stores, not the system or its managers.
- **Inside the system, the parts react.** A part that needs data another part owns watches the store ([Sharing Data: the Store First](#sharing-data-the-store-first)), and what does not fit the store goes over the event bus ([Event Sources](#event-sources)). Neither side then knows the other, so one can change or be left out without the other noticing.

### The Router

A `Router` is an ordinary object, usable with or without a `LiveSystem`:

```ts
const router = new Router()
router.register('managers/:key/update', (params, data) => { ... })

const response = await router.handle({ route: 'managers/servers/update', data: { scalingMode: 'manual' } })
```

- A pattern is made of literal and `:param` segments, and matches a route with the same number of segments. Where several patterns match, the first segment in which they differ decides, and a literal beats a `:param`.
- Registering a route that already exists throws. Two patterns that differ only in their parameter names are the same route.
- `handle()` never rejects. It resolves with a `CommandResponse`:

    ```ts
    type CommandResponse<R = unknown> =
        | { status: 'accepted'; result?: R }
        | { status: 'failed'; error: { name: string; message: string; code: string } }
    ```

    An unknown route fails with the code `not_found`. A handler chooses its own code by throwing a `CommandError`; anything else it throws is reported with the code `internal`.

`fillRoute('servers/:id/remove', { id: '42' })` builds a route from its pattern, for an application's command creators. It throws on a missing parameter.

### The CommandServer

The `CommandServer` is the HTTP adapter. A command is posted to one path (`/command` unless another is given) with the command as the JSON body:

```ts
const commands = new CommandServer({ router })
commands.listen({ port: 3031 })
```

```text
POST /command
{ "route": "managers/servers/update", "data": { "scalingMode": "manual" } }
```

The response body is always the `CommandResponse`. The HTTP status is 200 when the command was accepted, 400 for a body that is not a command, 404 for an unknown route, 405 for anything but POST, and 500 for any other failure. `handle(request)` works on the standard `Request` and `Response`, so the same server can be mounted in another HTTP server; `listen()` uses Bun's.

Given a `health` function, the server also answers a GET to `/health` (or the `healthPath` given), for whatever watches the process from outside: 200 with `{ "status": "ok" }` while the function returns true, 503 with `{ "status": "unavailable" }` when it returns false or throws. What "in working order" means is the application's to say. Without the function there is no health address.

### The CommandClient

The `CommandClient` is the other end, in a web app. It posts a command to the `CommandServer` and returns its response:

```ts
const commands = new CommandClient({ url: 'http://localhost:3031/command' })

const response = await commands.send(createUpdateManagerCommand('servers', { scalingMode: 'manual' }))
```

`send` resolves with the response when the command was accepted (`{ status: 'accepted', result? }`) and rejects with a `CommandError` when it was not. Every failure is a `CommandError`, so a component catches one type and decides what to show. The server's errors keep their names, messages and codes. The client adds two codes for the transport: `unreachable` when the request got no answer (the cause is kept in `cause`), and `bad_response` when the answer was not a `CommandResponse`. Nothing is retried.

The client builds no commands. Those come from the application's command creators, in its protocol (see [Protocols](#protocols)).

Decisions: [ADR 009](decisions/009-commands-events-crud.md), [ADR 013](decisions/013-server-web-symmetry.md).

## Events

Events report things that happened.

Commands and events have different semantics:

```text
Command
    "Please do this."

Event
    "This happened."
```

This distinction allows independent components to communicate without requiring direct knowledge of each other.

### Event Sources

There is no single channel that carries every event. Events come from several sources, each with its own way to subscribe:

| Source         | What it reports                                                     | Example                       |
| -------------- | ------------------------------------------------------------------- | ----------------------------- |
| Record source  | a record of one kind was created, updated, patched, or removed      | a `ServerRecord` was patched  |
| Reactive state | a value in the local reactive state changed                         | the number of servers changed |
| Event bus      | a domain event, published by one part of the application for others | `commandFinished`             |
| Lifecycle      | the system moved to another lifecycle state                         | the system reached `RUNNING`  |

Conceptually:

```ts
// Record source: a change to one kind of record
source.onPatched(record => {
    this.handlePatched(record)
})

// Reactive state: a change to a value
watch(
    () => Object.keys(servers.records).length,
    count => {
        this.handleServerCount(count)
    },
)

// Event bus: a domain event
events.on('commandFinished', event => {
    this.handleFinished(event)
})
```

The event bus is a tool LiveSystem provides, not a requirement. Data is shared through the store first ([Sharing Data: the Store First](#sharing-data-the-store-first)), and the event bus is for "special" communication between parts that should not know each other. There are two cases so far:

- **Live objects communicating among themselves, as live objects.** In the demo, the virtual users' commands and the servers' answers.
- **A part reporting data for a record it does not own, to the manager that owns it.** The part that has the data does not write another manager's record itself: it announces the data as an event, and the owner writes it. The demo has no case of this at present, since each of its parts writes only records it owns.

An event's name is the application's to choose: to the bus it is only a string, and its form changes nothing in how it is delivered. Where several parts report the same kind of data, naming the part in the event (`orders.backlogChanged`) is one way to tell their reports apart.

An application whose record changes and reactive state already say everything needs no event bus.

### The Event Bus

`EventBus<E>` is typed by the application's own event map, from an event's name to its payload. The demo's, in its protocol:

```ts
interface DemoEvents {
    commandRequested: CommandRequestedEvent
    commandQueued: CommandQueuedEvent
    commandStarted: CommandStartedEvent
    commandRefused: CommandRefusedEvent
    commandFinished: CommandFinishedEvent
    userRemoved: UserRemovedEvent
}

const events = new EventBus<DemoEvents>()

const unsubscribe = events.on('commandFinished', event => { ... })
events.once('userRemoved', event => { ... })

events.emit('userRemoved', { userId: '12' })
```

- An event whose payload is `void` is emitted with its name alone: `events.emit('idle')`.
- `on` and `once` return an `Unsubscribe` function, the only way to end a subscription ("Event and Subscription Cleanup").
- Delivery is synchronous, in the order the listeners subscribed. A listener added or removed during delivery takes effect from the next event.
- A listener that throws stops neither the other listeners nor the emitter. The error goes to the `onError` option, which logs with `console.error` by default. An async listener is not awaited, and its rejection goes to `onError` too.
- `listenerCount(name)` lets a test show that a manager or a live object released its listeners.
- There are no wildcards, no `clear()` and no history of past events.

The lifecycle is a lesser source: most parts learn about lifecycle changes through their own `init()`, `start()`, `run()`, and `stop()` methods rather than by subscribing.

Decision: [ADR 009](decisions/009-commands-events-crud.md).

## Protocols

Application-specific vocabulary does not belong in LiveSystem.

For example, a trading application may define:

```text
TradeSystem
└── packages
    └── protocol
        ├── services.ts        service paths, one per kind of record
        ├── events.ts          event bus events, if used
        ├── orders/
        │   ├── orders.record.ts      the record's fields
        │   ├── orders.routes.ts      route patterns for its commands
        │   ├── orders.commands.ts    each command's data and its creator
        │   └── orders.constants.ts
        └── positions/
            └── ...
```

The protocol is organized by domain: a domain's records, routes and commands sit together, as a manager owns one domain. A file's name begins with its domain, so that among open files `orders.commands.ts` is not mistaken for another domain's. A command creator is named for what it returns, `createCancelOrderCommand()`: it builds the command and does not send it.

LiveSystem provides the machinery for handling these concepts.

The application defines their meaning.

> **LiveSystem provides the grammar. The application provides the language.**

There should therefore be no generic `shared` or application-specific `protocol` package inside LiveSystem.

Decision: [ADR 010](decisions/010-applications-own-protocol.md).

## Event and Subscription Cleanup

Whatever subscribes is responsible for unsubscribing.

This applies to anything that subscribes, whether a manager, a live object, or another part of the application, and to every event source: record sources, reactive state, the event bus, and the lifecycle.

Subscriptions should return cleanup functions.

```ts
type Unsubscribe = () => void
```

For example:

```ts
const unsubscribe = source.onCreated(record => {
    this.handleCreated(record)
})
```

The subscriber retains each unsubscribe function, or the id that stands in for one (a timer id, for example), and invokes it at the end of its own life or at shutdown, whichever comes first:

- a manager, in `stop()`
- a live object, in `destroy()`

This prevents:

- zombie listeners
- duplicate subscriptions
- objects surviving their owners
- callbacks firing after shutdown

Cleanup is therefore part of the lifecycle model rather than an afterthought.

Decisions: [ADR 006](decisions/006-record-source-boundary.md), [ADR 015](decisions/015-timers-belong-to-owner.md).

## Demo Application

The LiveSystem repository contains a self-contained demonstration application, a **Virtual Infrastructure Simulator**: virtual users generate commands, virtual servers with finite capacity process them, and a manager adds or removes servers as load changes.

The examples in this document take their names from it (`VirtualServer`, `UserManager`, `ServerManager`). Its design is in [Demo Architecture](architecture-demo.md).

## Package Structure

The LiveSystem repository is a Bun workspace:

```text
live-system/
│
├── packages/
│   ├── live-system/           core, server and web entry points
│   ├── micro-fsm/             the state machine behind the lifecycle
│   └── feathers-connect/      the Feathers connection and record sources
│
├── examples/
│   └── virtual-infrastructure/
│
├── package.json
└── README.md
```

`live-system` is one package with three entry points:

| Entry point | Holds                                                                                                                                                                 |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `core`      | what both sides share: the lifecycle, `BaseManager`, `DataManager<T>`, `LiveObjectManager<T, O>`, `RecordSource`, the record store, the optional event bus, the clock |
| `server`    | the router and the `CommandServer`, which turns an HTTP request into a command                                                                                        |
| `web`       | the `CommandClient` and `WebStartup`, which boots a web app's system and keeps its status                                                                             |

`micro-fsm` and `feathers-connect` start in this workspace and are built to move to repositories of their own.

The demo consumes the actual LiveSystem packages rather than bypassing them with demo-specific implementations. It therefore serves as a continuous integration and architectural proving ground.

Application-specific concepts from the demo do not leak into the reusable packages. For example:

```text
VirtualUser
VirtualServer
ServerManager
UserManager
```

belong to the demo application, not LiveSystem itself.

Decision: [ADR 012](decisions/012-bun-workspace-and-demo.md).

## Processes, Server and Web

A running system is at least three processes:

```text
              Data service
          (Feathers with SQLite)
                   │
        ┌──────────┴──────────┐
        │                     │
   Live server             Web app
        │                     │
   managers and            managers
   live objects               │
        │                     │
   writes records         sends commands
```

The live server and every web app are clients of the data service. A system may have several web apps, all built the same way.

The two sides are symmetric where possible. Both use the same `BaseManager` and `DataManager<T>`, connect to the data service, and mirror its records into a store. They differ in what they may do:

- The server owns the live objects and is the only writer of records.
- A web app is a display of what happens on the server. It has managers and no live objects, never writes records, and changes things only by sending commands.

### Starting a Web App

A web app's system is a `LiveSystem` without a router. Booting it connects to the data service, then has each data manager load its records into the store.

The app does not wait for that to be shown. It is mounted at once and renders from what it knows, which is three separate things:

| What              | Says                                                                     | Comes from                              |
| ----------------- | ------------------------------------------------------------------------ | --------------------------------------- |
| System status     | `created`, `starting`, `running`, `failed` (with the error) or `stopped` | `WebStartup`, in `live-system/web`      |
| Connection status | whether the data service is connected, after startup as well             | the application, from its connection    |
| Record state      | what a record's own fields say, such as a server that is starting        | the application's records, in the store |

`WebStartup` boots the system and keeps the system status as reactive state:

```ts
const startup = new WebStartup(system)

app.provide('status', startup.status)
app.mount('#app')
startup.start()
```

```html
<LoadingScreen v-if="status.phase === 'starting'" />
<StartupFailed v-else-if="status.phase === 'failed'" :error="status.error" />
<MainPanel v-else />
```

`start()` does not reject when the boot fails: the failure is in `status`, where the UI reads it. `stop()` shuts the system down.

The connection status is not part of LiveSystem, which opens no connection. The application keeps it, for example in a `ref` set from its connection's `onConnected` and `onDisconnected`, and shows a warning while it is false. When the connection comes back, the data managers bring their stores up to date by themselves ([ADR 017](decisions/017-resync-on-reconnect.md)).

Decision: [ADR 013](decisions/013-server-web-symmetry.md).

## What LiveSystem Is Not

LiveSystem is not intended to be:

- a database
- a REST framework
- a UI framework
- a distributed actor framework
- a workflow engine
- a cloud infrastructure platform
- a general-purpose state management library

It may integrate with each of these categories of technology, but it should remain focused on its core problem:

> **Providing simple primitives for building long-lived, reactive systems.**

## Architectural Test

A useful test for the architecture is whether a developer can describe an application as:

```text
What exists?
    → Live Objects

Who owns those things?
    → Managers

What can happen?
    → Commands

What happened?
    → Events

Where does persistent state live?
    → Record Source

How does the system start and stop?
    → Lifecycle

How does the system continue operating?
    → Live object behavior + managers + events + timers
```

If an application can be expressed naturally using these primitives, LiveSystem is doing its job.

## Guiding Principle

The framework should remain small.

The objective is not to build a giant framework containing every possible abstraction.

The objective is to provide a small number of strong primitives that allow applications to express rich, long-lived behavior without becoming correspondingly complicated.

> **A small number of simple primitives can support surprisingly rich, long-lived systems without requiring the application to become correspondingly complex.**

## Decisions

The reasons behind this design, and the options that were rejected, are recorded as architecture decision records in [decisions/](decisions/):

- [ADR 001: Long-Lived Managed Objects, Not Actors](decisions/001-long-lived-managed-objects.md)
- [ADR 002: Managers Own Existence, Objects Own Behavior](decisions/002-managers-own-existence.md)
- [ADR 003: An Explicit Async Lifecycle With a Ready State](decisions/003-explicit-async-lifecycle.md)
- [ADR 004: A Lifecycle Runner Over a Small State Machine of Our Own](decisions/004-lifecycle-runner-and-state-machine.md)
- [ADR 005: Managers Inherit Capabilities, Not Technologies](decisions/005-manager-capabilities.md)
- [ADR 006: The RecordSource Boundary](decisions/006-record-source-boundary.md)
- [ADR 007: An Event-Based Data Service Is the Single Source of Truth](decisions/007-data-service-source-of-truth.md)
- [ADR 008: Startup Sync: Subscribe, Snapshot, Reconcile](decisions/008-startup-sync.md)
- [ADR 009: Commands, Events and CRUD Are Separate](decisions/009-commands-events-crud.md)
- [ADR 010: Applications Own Their Protocol](decisions/010-applications-own-protocol.md)
- [ADR 011: Plain TypeScript Classes; Vue Reactivity as a Library](decisions/011-plain-typescript-vue-reactivity.md)
- [ADR 012: One Bun Workspace With a Demo That Uses the Real Packages](decisions/012-bun-workspace-and-demo.md)
- [ADR 013: Server and Web Are Symmetric Where Possible](decisions/013-server-web-symmetry.md)
- [ADR 014: Failure and Shutdown](decisions/014-failure-and-shutdown.md)
- [ADR 015: No Scheduler: Timers Belong to Their Owner](decisions/015-timers-belong-to-owner.md)
- [ADR 016: Records Hold the Live State](decisions/016-records-hold-live-state.md)
- [ADR 017: Resync on Reconnect: Fetch Again, Apply the Difference](decisions/017-resync-on-reconnect.md)
