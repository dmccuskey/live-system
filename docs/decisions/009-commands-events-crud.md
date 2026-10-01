# ADR 009: Commands, Events and CRUD Are Separate

**Status:** Accepted

## Context

Three different things travel through a live system, and they are easy to blur:

- a request that the system do something ("restart this server"),
- a report that something happened,
- a change to a record.

Treating a command as a record change loses the intent. Treating everything as one kind of event on one bus hides where each comes from and who may send it.

An earlier prototype had a working command router, with literal and `:param` path segments and managers registering their own routes. It overwrote a duplicate route silently, rejected an unknown route with a bare error, and took the first pattern that matched. Its event bus was a single shared object with a method for each event.

## Decision

**Commands.** A command is a route plus data:

```ts
interface Command<T = unknown> {
    route: string
    data: T
}
```

- The route names the action and what it applies to (`server/42/restart`). The data carries its arguments.
- The router is a command dispatcher, not a REST router. HTTP POST, a WebSocket message and an internal call are adapters around it.
- A manager declares the routes it handles in `routes()`. The system registers them when the manager is added, binds each handler to its manager, and keeps a reference to the manager on each route. Removing a manager removes its routes.
- Registering a route that already exists is an error at registration. A command with no matching route fails with a structured "not found" error ([ADR 014](014-failure-and-shutdown.md)). A literal segment takes precedence over a `:param` segment.
- A command's response is a small object. It says that the command was accepted, or that it failed and why:

  ```ts
  type CommandResponse<R = unknown> =
      | { status: 'accepted'; result?: R }
      | { status: 'failed'; error: CommandError }
  ```

  When a command is accepted, `result` may carry what the sender needs to follow up, such as the ID of a record the command created, so the sender knows which record to watch. Progress and outcomes still reach the sender as record changes ([ADR 016](016-records-hold-live-state.md)).
- The router is needed only on the server.

**Events.** Events report what happened. They come from several sources, each with its own way to subscribe, and are not broadcast over one channel:

1. A record source: a record was created, updated, patched or removed ([ADR 006](006-record-source-boundary.md)).
2. Reactive state: a value in the local store changed ([ADR 011](011-plain-typescript-vue-reactivity.md)).
3. The event bus: a domain event between parts that should not know each other.
4. The lifecycle, to a lesser extent: the system changed state ([ADR 003](003-explicit-async-lifecycle.md)).

The event bus is a tool LiveSystem provides, not a requirement. An application uses it only if its design needs it, and the core works without one. It is an instance passed to managers in their context, not a global, and subscribing returns an `Unsubscribe` function. The application defines its events and their payloads ([ADR 010](010-applications-own-protocol.md)).

**CRUD.** Record changes go through the record source and follow the write rules of [ADR 007](007-data-service-source-of-truth.md). They are not commands.

Rejected:

- **One route with the action name inside the payload.** The route no longer says what is being asked.
- **A central route file.** A manager's commands belong with the manager.
- **Treating commands as CRUD.** "Restart" is not a field to patch.
- **One typed mechanism for every kind of event.** The sources differ in what they report and in who may emit.
- **Progress events for long commands.** Progress is state, and state lives in records. A response may name the record to watch; it does not open a second channel.

## Consequences

- A command can arrive over any transport and is handled the same way.
- The commands a system accepts are the sum of its managers' routes, and they come and go with the managers.
- A mistake in routing shows up at startup (a duplicate) or as a clear error (not found), not as a silent overwrite.
- A sender that wants a command's result watches records, which the web already does.
- There are four ways to hear about a change, and choosing among them takes understanding of each.
- The shape of the routes map and of the event bus's interface is left to the implementation.
