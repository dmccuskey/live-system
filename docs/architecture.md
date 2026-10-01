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

An application creates one instance of `LiveSystem`, adds its managers, and starts it:

```ts
const system = new LiveSystem()

system.addManager(new UserManager())
system.addManager(new ServerManager())

await system.start()
```

Constructor arguments are left out here; [Managers](#managers) shows what a manager receives.

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

The exact implementation may use a small state machine, but the state machine is an implementation detail of the lifecycle system.

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

The runner advances the system through its lifecycle:

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

If initialization fails, the transition fails and the system does not silently advance to the next state.

## Managers

Managers organize related application behavior.

A manager may:

- own a collection of records
- create and destroy live objects
- register commands
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
abstract class BaseManager {
    constructor(
        protected readonly context: ManagerContext
    ) {}

    async init(): Promise<void> {}
    async start(): Promise<void> {}
    async run(): Promise<void> {}
    async stop(): Promise<void> {}
}
```

Managers should not assume that the application uses Feathers, Vue, SQLite, HTTP, or any other particular technology.

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

A record might describe:

```ts
interface VirtualServerRecord {
    id: string
    cpuCapacity: number
    memoryCapacity: number
}
```

The corresponding live object might additionally contain:

```text
current utilization
active work
timers
subscriptions
pending operations
behavior
```

This distinction is important:

```text
Record
  = description of state

Live Object
  = state + behavior + existence
```

A manager creates and destroys the live object.

The object manages what happens while it exists.

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

The object can perform its own cleanup:

```ts
destroy() {
    if (this.destroyed) return

    this.destroyed = true

    this.stopTimers()
    this.removeListeners()
    this.cancelPendingWork()

    this.options.onDestroyed()
}
```

This allows a simple mechanism to control basic parent-child ownership.

Events remain useful for communication between independent parts of the system.

## Data and Record Sources

LiveSystem separates application behavior from persistence and transport.

A record source provides access to one kind of record. It is not the whole data store or the connection to it: with Feathers, a record source wraps a single service, and every record source shares the one connection.

```ts
interface RecordSource<T> {
    find(): Promise<T[]>

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

## Protocols

Application-specific vocabulary does not belong in LiveSystem.

For example, a trading application may define:

```text
TradeSystem
└── packages
    └── protocol
        ├── commands
        ├── events
        ├── records
        └── routes
```

LiveSystem provides the machinery for handling these concepts.

The application defines their meaning.

> **LiveSystem provides the grammar. The application provides the language.**

There should therefore be no generic `shared` or application-specific `protocol` package inside LiveSystem.

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

## Demo Application

The LiveSystem repository will contain a self-contained demonstration application.

The demo is a **Virtual Infrastructure Simulator**.

Its purpose is not to model real cloud infrastructure accurately. Its purpose is to demonstrate the LiveSystem architecture through a continuously operating system.

The simulator contains two primary domains:

```text
Virtual Infrastructure
│
├── Users
└── Servers
```

### Users

Virtual users continuously generate commands.

Each user has a fixed behavioral profile:

```ts
interface VirtualUserProfile {
    commandsPerMinute: number

    commandMix: {
        search: number
        standard: number
        agentic: number
    }
}
```

The profile is generated when the user is created.

The Demo User can add or remove users but does not directly manipulate their generated behavioral characteristics in the initial version.

This intentional variability creates an unpredictable workload.

For example:

```text
Search
    low resource consumption
    short duration

Standard
    moderate resource consumption
    moderate duration

Agentic
    high resource consumption
    long duration
```

The system therefore produces changing infrastructure conditions without requiring the Demo User to manually generate every workload event.

## Virtual Users as Live Objects

A virtual user is an autonomous live object.

Its behavior includes:

```text
generate commands
       ↓
submit commands
       ↓
observe completion
       ↓
measure unmet demand
       ↓
update frustration
```

The UserManager owns the user's existence.

The User object owns the user's ongoing behavior.

This makes the simulator a concrete demonstration of LiveSystem's object model.

## Virtual Servers

Servers provide finite resources.

A server might expose:

```text
CPU capacity
Memory capacity
Storage capacity
Current utilization
Active commands
```

Commands are routed to available servers.

Server load changes as commands begin and complete.

The exact resource simulation should remain deliberately simple and understandable.

The goal is to demonstrate dynamic behavior rather than create a production-grade infrastructure simulator.

## Server Management

The ServerManager supports two modes.

### Automatic

The ServerManager monitors infrastructure utilization and adds or removes servers according to a scaling policy.

The Demo User configures a maximum utilization threshold.

For example:

```text
Maximum utilization: 75%
```

If sustained utilization exceeds the threshold, the manager adds capacity.

If utilization remains sufficiently below the threshold, the manager may remove excess capacity.

Scale-up and scale-down thresholds should use hysteresis so that the system does not rapidly oscillate between adding and removing servers.

For example:

```text
Scale up:   > 75%
Scale down: < 35%
```

The exact values are configuration rather than architectural requirements.

### Manual

The Demo User controls the server population directly.

The UI provides:

```text
+ Add Server
- Remove Server
```

The user can therefore observe server utilization and decide when additional capacity is required.

The underlying server objects and command processing remain identical in both modes.

The difference is simply who makes the scaling decision.

## User Frustration

The simulator should model user experience rather than treating server utilization as the only important metric.

A user's expected throughput is based on their activity rate.

For example:

```text
Expected:
10 commands/minute

Actual:
6 commands/minute
```

The difference represents unmet demand.

Frustration increases as unmet demand persists and decreases as the system recovers.

Conceptually:

```text
expected throughput
        │
        ▼
   ┌──────────┐
   │  User    │
   └────┬─────┘
        │
        ▼
actual throughput
        │
        ▼
   unmet demand
        │
        ▼
    frustration
```

Frustration is therefore an emergent property of the system rather than a manually controlled variable.

This allows the demo to show that infrastructure health and user experience are related but not identical.

## Demo User Interface

The Demo User interacts primarily with the environment.

Initial controls should include:

```text
Users
    [+ Add User]

Servers
    Mode: [Automatic | Manual]

    Maximum utilization: [slider]

    [In manual mode]
    [+ Add Server]
```

Each user has a direct remove control:

```text
Alice                              [-]
Bob                                [-]
Charlie                            [-]
```

The user profile displays:

```text
Alice

Activity:       8 commands/min
Search:         70%
Standard:       20%
Agentic:        10%

Frustration:    14%
```

The command mix is visible but not editable in the initial version.

Later versions may allow the activity rate to be adjusted with a slider.

The command mix should remain fixed initially so that changing infrastructure produces interesting behavior without giving the Demo User direct control over every variable.

## Demonstration Goals

The demo should make several architectural properties observable.

### Autonomous Behavior

The system continues doing work even when the Demo User does nothing.

### Dynamic Object Creation

Users and servers can appear and disappear while the system is running.

### Long-Lived State

Objects maintain state across many interactions.

### Event-Driven Behavior

Changes in one part of the system cause other components to react.

### Command Routing

Generated commands are routed to available resources.

### Resource Constraints

Finite server capacity affects system behavior.

### Autonomous Management

The ServerManager can observe conditions and make scaling decisions.

### Emergent Behavior

Randomized user activity and differing command costs create changing conditions.

### Reactive Presentation

The UI continuously reflects the state of the running system.

## Package Structure

The initial LiveSystem repository should be a Bun workspace.

Conceptually:

```text
live-system/
│
├── packages/
│   ├── core/
│   ├── server-event-kit/
│   └── web-event-kit/
│
├── examples/
│   └── virtual-infrastructure/
│
├── package.json
└── README.md
```

The exact package boundaries may evolve as implementation proceeds.

The demo should consume the actual LiveSystem packages rather than bypassing them with demo-specific implementations.

The demo therefore serves as a continuous integration and architectural proving ground.

## Relationship to ServerEventKit and WebEventKit

The reusable system should remain separated into layers.

Conceptually:

```text
                 LiveSystem
                     │
          ┌──────────┴──────────┐
          │                     │
   ServerEventKit          WebEventKit
          │                     │
          ▼                     ▼
      Server-side           Browser-side
      event/runtime         event/runtime
```

The exact responsibilities of these packages should be determined during implementation.

The important architectural constraint is that application-specific concepts from the demo should not leak into the reusable packages.

For example:

```text
VirtualUser
VirtualServer
ServerManager
UserManager
```

belong to the demo application, not LiveSystem itself.

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
    → Live object behavior + managers + events + scheduling
```

If an application can be expressed naturally using these primitives, LiveSystem is doing its job.

## Guiding Principle

The framework should remain small.

The objective is not to build a giant framework containing every possible abstraction.

The objective is to provide a small number of strong primitives that allow applications to express rich, long-lived behavior without becoming correspondingly complicated.

> **A small number of simple primitives can support surprisingly rich, long-lived systems without requiring the application to become correspondingly complex.**
