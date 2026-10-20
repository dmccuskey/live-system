# LiveSystem

A lightweight TypeScript framework for building applications whose state and behavior remain alive over time.

LiveSystem treats an application as a living system, not a collection of request handlers. The application starts, brings up its components in order, and then keeps running: its objects do work, react to events, and hold state across many interactions.

It is designed for soft-realtime applications, such as a trading backend, and is also useful for realistic prototypes, which emulate the systems behind an interface. Other uses may fit the same architecture. See [What It Is For](docs/architecture.md#what-it-is-for).

A command asks the running system to do something. It is a route plus data, and it is not tied to HTTP:

```ts
router.handle({
    route: 'managers/servers/update',
    data: { scalingMode: 'manual' },
})
```

## Status

The primitives are implemented: the lifecycle over its state machine, [Micro FSM](https://github.com/dmccuskey/micro-fsm) (a repository of its own), managers and live objects, commands (the `Router`, the `CommandServer` and the `CommandClient`), the event bus, and data: record sources, the record store and the Feathers connection, [Feathers Connect](https://github.com/dmccuskey/feathers-connect) (a repository of its own). What is in place is listed under [Current Baseline](docs/development.md#current-baseline). The demo runs on all of it ([Running the Demo](docs/development.md#running-the-demo)). The `live-system` package is released for other projects as a tarball on GitHub, not on npm, and its API may still change: see [Using the Package](packages/live-system/README.md). The design is in [docs/architecture.md](docs/architecture.md).

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

Technology stays at the edges: LiveSystem does not require a particular database or transport. Its local state is held in stores on Vue's reactivity, on the server as on the web, with no UI needed. A Vue app may use them as [Pinia](https://pinia.vuejs.org) stores, and a UI in Svelte, React or Angular reads them through `readable()`.

## The Demo

The repository includes a self-contained demo, a Virtual Infrastructure Simulator. Virtual users generate commands on their own, virtual servers with finite capacity process them, and a manager adds or removes servers as load changes. A web app shows it all as it happens. It is built on the real LiveSystem packages, so it also proves the design. See [Demo Architecture](docs/architecture-demo.md), and [Running the Demo](docs/development.md#running-the-demo) to start it.

## Documentation

- [Architecture](docs/architecture.md): the design and the package structure.
- [Demo Architecture](docs/architecture-demo.md): the design of the demo application.

Everything else is listed on the [documentation home](docs/README.md).

## License

[MIT](LICENSE)
