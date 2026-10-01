# ADR 002: Managers Own Existence, Objects Own Behavior

**Status:** Accepted

## Context

A live object holds timers, subscriptions and pending work. Something has to decide when it is created and when it goes away, and something has to release what it holds. If those responsibilities are unclear, objects outlive their owners and listeners fire after shutdown.

An earlier prototype kept its objects in module-level registries, so two runtimes in one process would have shared them. It also considered announcing an object's destruction on the event bus, which turns a parent-child relationship into a broadcast.

## Decision

> The manager owns the existence of an object. The object owns what happens during its existence.

- A manager creates, tracks and removes its objects, in a registry held on the manager instance.
- An object owns its timers and listeners and releases them in `destroy()`. `destroy()` is idempotent: calling it twice does nothing the second time.
- An object tells its owner that it is gone through an `onDestroyed` callback passed in at creation, not through an event.
- A changed record updates the existing live object. It does not replace it.
- A record does not imply a live object, and not every manager owns objects. A manager may only mirror records into the store.

Rejected:

- **A "destroyed" event on the event bus.** The owner is known; a broadcast is not needed to reach it.
- **Destroying objects through a UI framework's instance lifecycle.** The object model is plain TypeScript ([ADR 011](011-plain-typescript-vue-reactivity.md)).
- **Module-level registries.** They are shared between runtimes and between tests.

## Consequences

- Shutdown is a walk down the ownership tree: the system stops managers, managers destroy objects, objects release what they hold.
- Two systems can run in one process, which also makes tests independent.
- An object can end its own life (for example when its work is finished) and its manager still learns of it.
- The event bus stays free for communication between independent parts ([ADR 009](009-commands-events-crud.md)).
