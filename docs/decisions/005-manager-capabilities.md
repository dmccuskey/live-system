# ADR 005: Managers Inherit Capabilities, Not Technologies

**Status:** Accepted

## Context

In an earlier prototype, seven managers repeated the same structure: receive the same dependencies, wrap one data service, subscribe to its change events, load its records, implement the lifecycle hooks. What varied was the useful part: some managers owned live objects, some only mirrored records into the store, and one did neither.

A base class should remove the repetition without assuming every manager is the same kind, and without tying managers to the data technology in use.

## Decision

Managers are built in layers, each adding a capability:

```text
BaseManager
    │
    ├── DataManager<T>
    │       ├── UserManager
    │       ├── ServerManager
    │       └── ...
    │
    └── a manager that needs no data
```

- `BaseManager` has the lifecycle hooks (`init`, `start`, `run`, `stop`), the shared context, and `routes()`. Nothing else.
- `DataManager<T>` adds what working with one kind of record needs: its record source ([ADR 006](006-record-source-boundary.md)), the startup sync ([ADR 008](008-startup-sync.md)), the projection into the store, and an optional registry of live objects ([ADR 002](002-managers-own-existence.md)).
- A domain manager extends `DataManager<T>` and adds its behavior. `createObject(record)` is the hook it overrides when it owns live objects.
- A manager that needs no data extends `BaseManager` directly.

Rejected:

- **A `FeathersManager` middle layer.** It names a technology. The data technology sits behind the record source instead.
- **Component-framework inheritance with mixins.** See [ADR 011](011-plain-typescript-vue-reactivity.md).
- **One base class that does everything.** It forces object ownership and data sync on managers that need neither.
- **A manager defined by a configuration object.** Considered and not chosen: behavior reads more plainly as methods on a class.

## Consequences

- A domain manager contains mostly domain code.
- Managers never import Feathers, SQLite or HTTP.
- The same `BaseManager` and `DataManager<T>` serve the server and the web ([ADR 013](013-server-web-symmetry.md)).
- Inheritance is two levels deep. A capability that does not fit a line of inheritance will need another mechanism.
