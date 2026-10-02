# ADR 004: A Lifecycle Runner Over a Small State Machine of Our Own

**Status:** Accepted

## Context

The lifecycle of [ADR 003](003-explicit-async-lifecycle.md) needs something to hold the current state, something to advance it, and something that does the work of each state. An earlier prototype put all three in one system controller class, built on a general-purpose state machine package.

That package offers history, visualization and generated transition methods. The lifecycle needs none of them: it needs to know the current state and whether a transition is legal.

## Decision

Three small parts, each with one responsibility:

> LiveSystem owns the lifecycle. LifecycleRunner orchestrates it. The state machine enforces it.

**The system object.** An application creates one instance of the reusable `LiveSystem` class, adds its managers, and boots it:

```ts
const system = new LiveSystem<AppContext>({
    context: { events, store },
})

system.addManager(context => new UserManager(context, userSource))
system.addManager(context => new ServerManager(context, serverSource))

await system.boot()
```

- `addManager()` takes a function that creates the manager. The system calls it with the one context every manager shares, adds the manager to its registry, and registers the manager's routes ([ADR 009](009-commands-events-crud.md)).
- The context holds as little as possible: the event bus and the store. Its type is the application's own: `LiveSystem<C>` and `BaseManager<C>` carry it without naming its fields. The router and the system itself are not in it. What differs per manager, such as its record source ([ADR 006](006-record-source-boundary.md)), is passed by the function that creates it.
- The system opens no connection of its own. The application may pass `connect` and `disconnect` functions with the context, and the system calls them at the right points of the lifecycle.
- `boot()` hands startup to the runner. `shutdown()` is its counterpart ([ADR 014](014-failure-and-shutdown.md)).

**The runner.** `run()` makes the transitions in order. Each transition's `enter` calls back into the system to do that state's work:

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

`created` is the state before `boot()`, so the runner makes no transition into it. An `enter` never calls `transition` itself.

**The state machine.** `micro-fsm`, a package of our own with no dependencies. Its configuration is keyed by destination state, with `from` (one state, several, or `*`) and an async `enter`. `transition(target)` checks `from`, awaits `enter()`, then sets the state. It has no history, hierarchy, guard language or generated methods.

Rejected:

- **A general state machine package.** Most of it would go unused, and it is a dependency in the core.
- **Statecharts.** The lifecycle is a short line of states, not a hierarchy.
- **Lifecycle logic inside the system class.** It mixes holding the parts with sequencing them.

## Consequences

- Each part can be tested alone: the state machine with no system, the runner with a fake system.
- `micro-fsm` has no knowledge of LiveSystem and is built to move to its own repository.
- The lifecycle's order is readable in one place, the runner.
- There are three small classes where the prototype had one large one.
- The framework does not check what an application puts in its context. Keeping it small is the application's discipline.
