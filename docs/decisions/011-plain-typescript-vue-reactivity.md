# ADR 011: Plain TypeScript Classes; Vue Reactivity as a Library

**Status:** Accepted; amended 2026-10-19 (`@vue/reactivity` alone, Pinia optional, a UI that isn't Vue; see [Amendment](#amendment-2026-10-19-a-ui-that-isnt-vue))

## Context

An earlier prototype built its server objects as Vue 2 component instances: managers, live objects, the router and the event bus were all components without a template. That gave it reactive state and an event emitter for free, and tied the architecture, its inheritance and its object lifecycle to a UI framework's component model.

Vue 3 separates its reactivity (`reactive`, `ref`, `computed`, `watch`) from its components. The reactivity can be used on its own, with no UI.

## Decision

- The architecture, inheritance and lifecycle are ordinary TypeScript classes.
- Vue 3's reactivity is used as a library, inside objects and in the store, where reactive state helps.
- On the server, reactivity communicates data changes: a manager or a live object watches reactive state and acts when it changes. There are no components and nothing is rendered.
- In a web app, Vue is used in the standard way: the same reactive state also drives components.
- The store is a mirror of the data service on both sides ([ADR 007](007-data-service-source-of-truth.md)). The store is [Pinia](https://pinia.vuejs.org), with one store per kind of record, defined by `core`'s `defineRecordStore`. Pinia needs no Vue app, so the server uses it as the web does. The data service behind the record sources stays the application's choice ([ADR 006](006-record-source-boundary.md)); the store does not, because a store that could be anything would have to be hidden behind one more interface with nothing gained.

Rejected:

- **Vue components as the server's object model.** Class inheritance, constructors and typing all work against it, and the object's life is tied to the component's.
- **Component inheritance with mixins.** The same objection, plus unclear ownership of what each mixin adds.
- **RxJS.** It makes streams the one abstraction for everything. Most of this system is objects with state, for which a stream is the wrong shape.

## Consequences

- Managers and live objects are plain classes that can be constructed and tested without a framework.
- Server and web share the same reactive model, which supports their symmetry ([ADR 013](013-server-web-symmetry.md)).
- The server depends on Vue's reactivity and on Pinia, though not on Vue's components. (Since the amendment below, on `@vue/reactivity` alone.)
- A record in the store is replaced whole when it changes, never changed in place. The store tracks which records it holds, not what is inside them.
- A watcher is a subscription like any other and must be stopped by whatever started it ([ADR 006](006-record-source-boundary.md)).

## Amendment 2026-10-19: A UI That Isn't Vue

A UI built on LiveSystem need not be Vue: Svelte, React or Angular should read the store without bundling Vue's components. Vue's reactivity stays the engine inside the system, since its automatic dependency tracking is what makes managers and live objects easy to write. Only the edge toward a UI changes.

- **The engine is `@vue/reactivity`, not `vue`.** It is the same reactivity, published on its own, with `watch` since Vue 3.5. `live-system` takes it as a peer dependency, so that in a Vue app the two share one copy: with two copies a component would not react to the store. Its `watch` runs a watcher at once, where Vue's batches it before the next render by default.
- **The store is a `RecordStore`, and Pinia is optional.** `core`'s `createRecordStore()` makes one on Vue's reactivity alone. `live-system/pinia`'s `defineRecordStore` makes the same store as a Pinia store, for a Vue app that wants Pinia's devtools. The two share their code. The demo's live server uses `createRecordStore`, its web app Pinia. The reason above for one fixed store holds: the store is still one choice, whose reactivity is fixed.
- **A UI that isn't Vue reads through `readable()`** (`live-system/web`). It makes any reactive read, a record, a list, a value derived from several stores or a `WebStartup`'s status, a `Readable`: `get()` and `subscribe()`, which calls its listener at once and then once per batch of changes. That is Svelte's store contract, React's `useSyncExternalStore` takes it as is, and an Angular signal is set from it in a few lines. A listener follows only what its getter reads, so one record changing does not wake the listeners of another.

Rejected:

- **[Nanostores](https://github.com/nanostores/nanostores) as the engine.** Its `computed` lists its sources by hand, and a map store notifies every listener of any change, so a fine-grained UI would need a store per record. A nanostores atom has the shape of a `Readable`, so an app that wants nanostores' adapters copies one into the other.
- **A `subscribe()` on `RecordStore`.** It would cover whole stores only: a component wants one record or a list, and `WebStartup` is no store.
- **Dropping Pinia.** Vue apps would lose its devtools, and it was optional already.
