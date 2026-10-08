# ADR 006: The RecordSource Boundary

**Status:** Accepted; amended 2026-10-02 (see [Amendment](#amendment-2026-10-02-the-feathers-implementation))

## Context

Managers work with records: they load them, change them, and react when they change. In an earlier prototype the managers held a wrapper around a Feathers service directly, so the data technology reached into every manager.

That prototype's wrappers show the useful split: one object for the connection, through which every call goes, and one object per service for a single kind of record, offering the CRUD calls, a load-all call and the change events. The second is the boundary a manager needs.

The wrapper registered listeners with add and remove method pairs, and fired its own "loaded" event when the connection became ready.

## Decision

A manager reaches records through a `RecordSource<T>`, which covers one kind of record. With Feathers, that is one service.

```ts
interface RecordSource<T extends { id: string }> {
    find(): Promise<T[]>
    get(id: string): Promise<T>
    isNotFound(error: unknown): boolean

    create(data: Omit<T, 'id'> & { id?: string }): Promise<T>
    update(id: string, data: T): Promise<T>
    patch(id: string, data: Partial<T>): Promise<T>
    remove(id: string): Promise<T>

    onCreated(listener: (record: T) => void): Unsubscribe
    onUpdated(listener: (record: T) => void): Unsubscribe
    onPatched(listener: (record: T) => void): Unsubscribe
    onRemoved(listener: (record: T) => void): Unsubscribe
}
```

- A record source is not the whole data store or the connection to it. Every record source of an application shares the one connection.
- A record has a string `id`. A record to create may leave it out: the source then assigns one, which is how a backend that creates its own IDs (Feathers) works. A backend that names or types its ID otherwise (`_id`, a number) is converted by its implementation. How IDs are assigned is to be looked at again with the first backend that does not create them.
- `find()` returns an array. An implementation whose backend returns pages or a single record normalizes the result.
- `get(id)` rejects when the record does not exist, and `isNotFound(error)` says whether what a call rejected with means that. Any other failure says nothing of the record: the source may not have been reached. The startup sync depends on both ([ADR 008](008-startup-sync.md)).
- Each subscription returns an `Unsubscribe` function. Whatever subscribes keeps it and calls it at the end of its own life: a manager in `stop()`, a live object in `destroy()`.
- A record source does not load records on its own and has no "loaded" event. Loading is the `DataManager`'s job, during `init()`.
- Feathers is one implementation, provided by the `feathers-connect` package. `RecordSource` is LiveSystem's requirement, and the implementation satisfies it.

Rejected:

- **Managers holding a Feathers service directly.** Every manager then depends on Feathers.
- **A second abstraction over Feathers with no boundary of its own.** It hides Feathers without saying what a manager may rely on.
- **Add and remove listener pairs.** The subscriber must keep both the listener and the right remove method; a returned function carries both.

The name was `DataRepository` in the design discussion. It was changed because "repository" reads as a source code repository.

## Consequences

- A manager can be tested with a record source held in memory: `core` provides `MemoryRecordSource`.
- Other backends are possible by implementing the interface.
- The interface is small, and anything a backend offers beyond it (queries, pagination) is out of reach through it until the interface grows.
- The interface may still change where the existing wrapper code shows a better shape.

## Amendment 2026-10-02: The Feathers Implementation

Building `feathers-connect` settled what was left open above:

- **The interface is unchanged.** Nothing in the earlier wrappers had a better shape.
- **The data service creates string IDs.** A Feathers database adapter creates numeric IDs by default. The data service is set up to create strings instead, so the IDs in the database are the IDs in the records, a reference from one record to another has the same type as an ID, and a record created with an `id` keeps it. `FeathersRecordSource` renames the ID field where the backend calls it otherwise (`_id`) and converts no types.
- **`feathers-connect` does not import `RecordSource`.** It is built to move to a repository of its own, so it satisfies the interface by its shape. A test in the demo's live server, which depends on both packages, fails the typecheck if the two drift apart.
- **A failed call rejects with Feathers' own error,** unchanged, so a missing record (`NotFound`, code 404) can be told from another failure: that is its `isNotFound(error)`.
- **No authentication.** The earlier connection wrapper authenticated; this one does not, until authentication is designed ([ADR 013](013-server-web-symmetry.md)).
