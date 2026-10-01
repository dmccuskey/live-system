# ADR 007: An Event-Based Data Service Is the Single Source of Truth

**Status:** Accepted

## Context

A live system has state in several places at once: in the data service, in the server's memory, and in each web app showing it. If more than one of them can be changed first, they drift apart.

There is also more than one writer. Besides the live server, a record editor may change records directly during development, and several web apps may be open. A part that updates its own copy first, and tells the data service afterwards, is wrong as soon as another writer gets there before it.

## Decision

Every LiveSystem application has a data service that emits an event for each change: a record created, updated, patched or removed. It is the one source of truth for the server and for every web app.

- **Local state is a projection.** The store on the server and on the web mirrors what is in the data service. Which store an application uses is its own choice. Managers and live objects may hold a reference to it and react to its changes.
- **Changes go to the data service first.** Code asks the service to change a record and applies the change locally only when the service's change event comes back. The server never changes a live object before the data service.
- **Only the server writes records.** A web app never writes: it requests a change with a command ([ADR 009](009-commands-events-crud.md)). The one exception is a record editor used in development; the system reacts to its edits like any other change event.
- **Storage is SQLite**, behind the data service.

Rejected:

- **Optimistic local updates.** They need a way to undo, and they are wrong whenever another writer changed the record first.
- **Changing the store directly.** With several writers, a local write goes stale without anything noticing.
- **NeDB as storage.** It is no longer maintained.

## Consequences

- Every part sees the same state, in the same order, from the same events.
- Editing a record by hand in development produces the same reaction as the system changing it.
- A local change is visible only after a round trip to the data service. For a system driven by events this is the normal path, not a delay to work around.
- The data service must be running for anything to work, and it is a process of its own ([ADR 012](012-bun-workspace-and-demo.md)).
- What the records hold is in [ADR 016](016-records-hold-live-state.md).
