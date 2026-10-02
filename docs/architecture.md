# LiveSystem Architecture and Design

## Overview

**LiveSystem is a lightweight framework for building applications whose state and behavior remain alive over time.**

It provides simple primitives for lifecycle management, managers, live objects, commands, events, record sources, and reactive state. The goal is to make it easy to build systems that continuously operate, respond to changing conditions, and coordinate long-lived objects rather than treating every interaction as an isolated request.

The central idea is:

> **The application is a living system, not merely a collection of request handlers.**

LiveSystem is intentionally small. It does not attempt to provide a complete application framework, distributed actor system, workflow engine, or database abstraction. Instead, it provides a small set of composable primitives from which those applications can be built.

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

LiveSystem should not require a particular database, transport, UI framework, or persistence technology.

For example, Feathers can be used as a record source implementation, while Vue can provide reactive presentation state, but neither should define the architecture.

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

An application creates one instance of `LiveSystem`, adds its managers, and boots it:

```ts
const system = new LiveSystem<AppContext>({
    context: { events, store },
    connect: () => connection.open(),
    disconnect: () => connection.close()
})

system.addManager(context => new UserManager(context, userSource))
system.addManager(context => new ServerManager(context, serverSource))

await system.boot()
```

The system is given three things, all of them the application's: the context that every manager shares, and optionally how to connect to the infrastructure it depends on and how to disconnect from it. LiveSystem itself opens no connection, so it assumes no technology.

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

Managers have loaded their initial state and established their required resources.

### STARTED

Managers have started active behavior.

Examples:

- event subscriptions installed
- timers started
- background activity enabled
- live objects created

### RUNNING

The application is actively operating.

At this point the system is expected to remain alive and respond to commands, events, timers, and changes in state.

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
    │       ├── UserManager
    │       ├── ServerManager
    │       └── ...
    │
    └── SpecializedManager
```

`BaseManager` should remain intentionally small.

```ts
abstract class BaseManager<C = unknown> {
    constructor(
        protected readonly context: C
    ) {}

    routes(): Routes {
        return {}
    }

    async init(): Promise<void> {}
    async start(): Promise<void> {}
    async run(): Promise<void> {}
    async stop(): Promise<void> {}
}
```

A manager receives as little as possible. The context holds only what every manager shares. Its type is the application's own, since the store and the events are the application's choice:

```ts
interface AppContext {
    events: EventBus
    store: Store
}
```

The application's managers extend `BaseManager<AppContext>`, and the system is a `LiveSystem<AppContext>`.

The event bus is passed in rather than reached for globally, so a test can give a manager its own. The store is the application's local reactive state.

The router is not in the context. A manager declares the commands it handles, and the system registers them when the manager is added:

```ts
class ServerManager extends DataManager<VirtualServerRecord> {
    routes() {
        return {
            'server/:id/restart': this.restart
        }
    }
}
```

`routes()` returns plain functions, which carry no reference to the manager. The system adds that reference when it registers them: each route in the router records the manager that owns it, and the handler is called with that manager as `this`.

```text
route
├── pattern    'server/:id/restart'
├── handler    restart
└── manager    the ServerManager that declared it
```

Because each route knows its manager, removing a manager also removes its routes.

A manager that works with records also receives the record source for its one kind of record:

```ts
abstract class DataManager<T, C = unknown> extends BaseManager<C> {
    constructor(
        context: C,
        protected readonly source: RecordSource<T>
    ) {
        super(context)
    }
}
```

Managers should not assume that the application uses Feathers, Vue, SQLite, HTTP, or any other particular technology.

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

A record holds the object's state, including the state that changes as the system runs:

```ts
interface VirtualServerRecord {
    id: string
    cpuCapacity: number
    memoryCapacity: number
    utilization: number
    activeCommands: number
}
```

The corresponding live object reads and writes that record, and additionally holds what cannot be stored:

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

Decision: [ADR 016](decisions/016-records-hold-live-state.md), on what a record holds.

## Object Ownership

Object ownership follows a simple rule:

> **The Manager owns the existence of objects. The Object owns its own behavior.**

For example:

```ts
private createObject(record: VirtualServerRecord) {
    const object = new VirtualServer({
        record,

        onDestroyed: () => {
            this.deleteObject(record.id)
        }
    })

    this.objects.set(record.id, object)
}
```

The object performs its own cleanup. `LiveObject`, the base class, provides `destroy()`: it does nothing the second time it is called, calls the object's `release()`, and then tells the owner through `onDestroyed`. The object says what there is to release:

```ts
class VirtualServer extends LiveObject {
    protected release() {
        this.stopTimers()
        this.removeListeners()
        this.cancelPendingWork()
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
interface RecordSource<T> {
    find(): Promise<T[]>
    get(id: string): Promise<T>

    create(data: T): Promise<T>
    update(id: string, data: T): Promise<T>
    patch(id: string, data: Partial<T>): Promise<T>
    remove(id: string): Promise<T>

    onCreated(listener: (record: T) => void): Unsubscribe
    onUpdated(listener: (record: T) => void): Unsubscribe
    onPatched(listener: (record: T) => void): Unsubscribe
    onRemoved(listener: (record: T) => void): Unsubscribe
}
```

The implementation can vary:

```text
RecordSource
    │
    ├── MemoryRecordSource
    ├── SQLiteRecordSource
    ├── FeathersRecordSource
    └── ...
```

This allows the application architecture to remain independent of its storage technology.

Decisions: [ADR 006](decisions/006-record-source-boundary.md), [ADR 007](decisions/007-data-service-source-of-truth.md), [ADR 008](decisions/008-startup-sync.md).

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
        force: false
    }
})
```

The command router is therefore not necessarily a REST router.

It is a **command dispatcher**.

HTTP POST, WebSocket messages, internal method calls, or other transports may be adapters around the command system.

Decision: [ADR 009](decisions/009-commands-events-crud.md).

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

| Source | What it reports | Example |
|---|---|---|
| Record source | a record of one kind was created, updated, patched, or removed | a `VirtualServerRecord` was patched |
| Reactive state | a value in the local reactive state changed | the number of servers changed |
| Event bus | a domain event, published by one part of the application for others | `server.overloaded` |
| Lifecycle | the system moved to another lifecycle state | the system reached `RUNNING` |

Conceptually:

```ts
// Record source: a change to one kind of record
source.onPatched(record => {
    this.handlePatched(record)
})

// Reactive state: a change to a value
watch(() => state.servers.length, count => {
    this.handleServerCount(count)
})

// Event bus: a domain event
events.on('server.overloaded', event => {
    this.handleOverloaded(event)
})
```

The event bus is a tool LiveSystem provides, not a requirement. It is for domain events between parts that should not know each other, such as:

```text
server.overloaded
server.drained
pipeline.completed
```

An application whose record changes and reactive state already say everything needs no event bus.

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
        │   ├── record.ts      the record's fields
        │   ├── routes.ts      route patterns for its commands
        │   ├── commands.ts    each command's data and its creator
        │   └── constants.ts
        └── positions/
            └── ...
```

The protocol is organized by domain: a domain's records, routes and commands sit together, as a manager owns one domain.

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

The LiveSystem repository will contain a self-contained demonstration application, a **Virtual Infrastructure Simulator**: virtual users generate commands, virtual servers with finite capacity process them, and a manager adds or removes servers as load changes.

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

| Entry point | Holds |
|---|---|
| `core` | what both sides share: the lifecycle, `BaseManager`, `DataManager<T>`, `RecordSource`, the optional event bus |
| `server` | the router and the `CommandServer`, which turns an HTTP request into a command |
| `web` | the `CommandClient` and the web startup |

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
