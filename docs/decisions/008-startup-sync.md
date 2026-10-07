# ADR 008: Startup Sync: Subscribe, Snapshot, Reconcile

**Status:** Accepted

## Context

At startup a data manager needs every existing record and every change from then on, with nothing missed between the two. The data service gives no ordering guarantee between a `find()` result and the change events around it.

An earlier prototype attached its change listeners at one point and fetched records at another, with no rule for a change arriving in between. Fetching first and subscribing afterwards loses any change made during the fetch.

## Decision

A `DataManager` loads its records during `init()`, in this order:

1. **Subscribe** to the record source's change events. While loading, do not apply them: record the ID of each record that changes in a set.
2. **Fetch the snapshot** with `find()`.
3. **Reconcile.** For each ID in the set, fetch that record again with `get(id)`. A `get` that fails means the record was removed. Changes keep being recorded during these fetches, so the step repeats until a round ends with the set empty.
4. **Import** the result into the store in one batch, not record by record.
5. **Go live.** From here on, change events are applied as they arrive.

Rejected:

- **Fetch, then subscribe.** Changes made during the fetch are lost.
- **Replaying the buffered event payloads over the snapshot.** It depends on the order of events relative to the snapshot, which is not known. Refetching by ID asks the data service for the current truth instead.
- **Offset pagination while the data changes.** Records shift between pages. Measure before paginating at all.

## Consequences

- No change is missed during startup, whatever the timing.
- The cost is one extra `get` per record that changed during the load, which is normally few.
- The store receives the initial data as one change, so anything watching it reacts once.
- `RecordSource` must offer `get(id)` ([ADR 006](006-record-source-boundary.md)).
- A connection lost after startup is not covered here. Changes made while disconnected would be missed, and the same sequence would have to run again on reconnecting. [ADR 017](017-resync-on-reconnect.md) decides that.
