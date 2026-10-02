# LiveSystem

A lightweight TypeScript framework for building applications whose state and behavior remain alive over time.

LiveSystem treats an application as a living system, not a collection of request handlers. The application starts, brings up its components in order, and then keeps running: its objects do work, react to events, and hold state across many interactions.

A command asks the running system to do something. It is a route plus data, and it is not tied to HTTP:

```ts
router.handle({
    route: 'server/42/restart',
    data: { force: false }
})
```

## Status

LiveSystem is at the design stage. The workspace is scaffolded, with its packages in place and the first parts implemented: the state machine, [Micro FSM](packages/micro-fsm/README.md), the lifecycle runner over it, and the `LiveSystem`, `BaseManager` and `LiveObject` classes ([Development](docs/development.md)). Commands, events and data are not built, so there is nothing to run yet, and the example above shows the intended shape, not a published API. The design is in [docs/architecture.md](docs/architecture.md).

## Primitives

LiveSystem is intentionally small. It provides a few primitives that compose:

- **Lifecycle:** an explicit sequence of states from startup to shutdown. Each transition waits for its work to finish, and a failed transition stops the advance.
- **Managers:** each owns a collection of related objects and controls their creation and destruction.
- **Live objects:** things that exist continuously in the running system, with identity, state, behavior, and their own timers and subscriptions.
- **Commands:** requests for the system to do something, dispatched by route, whatever transport they arrived on.
- **Events:** reports of what happened, so independent parts can react without knowing each other.
- **Record sources:** each gives access to one kind of record and its change notifications, independent of the storage technology.
- **Reactive state:** a view of the data for presentation, kept apart from the architecture.
- **Cleanup:** every subscription returns an unsubscribe function, so shutdown releases what startup acquired.

Technology stays at the edges: LiveSystem does not require a particular database, transport, or UI framework.

## The Demo

The repository will include a self-contained demo, a Virtual Infrastructure Simulator. Virtual users generate commands on their own, virtual servers with finite capacity process them, and a manager adds or removes servers as load changes. It is built on the real LiveSystem packages, so it also proves the design. See [Demo Architecture](docs/architecture-demo.md).

## Documentation

- [Architecture](docs/architecture.md): the design and the planned package structure.
- [Demo Architecture](docs/architecture-demo.md): the design of the demo application.

Everything else is listed on the [documentation home](docs/README.md).

## License

[MIT](LICENSE)
