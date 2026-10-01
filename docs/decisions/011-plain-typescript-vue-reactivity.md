# ADR 011: Plain TypeScript Classes; Vue Reactivity as a Library

**Status:** Accepted

## Context

An earlier prototype built its server objects as Vue 2 component instances: managers, live objects, the router and the event bus were all components without a template. That gave it reactive state and an event emitter for free, and tied the architecture, its inheritance and its object lifecycle to a UI framework's component model.

Vue 3 separates its reactivity (`reactive`, `ref`, `computed`, `watch`) from its components. The reactivity can be used on its own, with no UI.

## Decision

- The architecture, inheritance and lifecycle are ordinary TypeScript classes.
- Vue 3's reactivity is used as a library, inside objects and in the store, where reactive state helps.
- On the server, reactivity communicates data changes: a manager or a live object watches reactive state and acts when it changes. There are no components and nothing is rendered.
- In a web app, Vue is used in the standard way: the same reactive state also drives components.
- The store is a mirror of the data service on both sides ([ADR 007](007-data-service-source-of-truth.md)). Which store an application uses is its own choice.

Rejected:

- **Vue components as the server's object model.** Class inheritance, constructors and typing all work against it, and the object's life is tied to the component's.
- **Component inheritance with mixins.** The same objection, plus unclear ownership of what each mixin adds.
- **RxJS.** It makes streams the one abstraction for everything. Most of this system is objects with state, for which a stream is the wrong shape.

## Consequences

- Managers and live objects are plain classes that can be constructed and tested without a framework.
- Server and web share the same reactive model, which supports their symmetry ([ADR 013](013-server-web-symmetry.md)).
- The server depends on Vue's reactivity package, though not on Vue's components.
- A watcher is a subscription like any other and must be stopped by whatever started it ([ADR 006](006-record-source-boundary.md)).
