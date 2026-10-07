# ADR 017: Resync on Reconnect: Fetch Again, Apply the Difference

**Status:** Accepted

## Context

The startup sync ([ADR 008](008-startup-sync.md)) misses no change while a `DataManager` loads. It left one case open: a connection to the data service that is lost after startup. Changes made while it is away emit no event that the manager hears, so when the connection comes back the store is stale, and nothing brings it up to date.

How often it happens depends on where the parts run:

- **On one machine or in one group of containers** it is rare. The realistic cause is the data service's process being killed and started again. Nothing changes the records while it is down, since every write goes through it, but each client reconnects on its own schedule: one that reconnects later misses what an earlier one wrote in between.
- **With a web app on a mobile device away from the local network** it is ordinary. The connection drops and returns while the data service runs on and the other clients keep writing.

Either way the case needs a defined answer, and a simple one.

Two things shape it:

- A `DataManager` knows its record source and not the connection ([ADR 006](006-record-source-boundary.md)), and a `LiveSystem` opens no connection of its own ([ADR 004](004-lifecycle-runner-and-state-machine.md)).
- Loading the store whole, as the startup sync does, would report every record as added. A `LiveObjectManager` would create a second object for each record, and everything watching a record would react although it had not changed.

## Decision

**The record source reports the gap.** `RecordSource` has `onReconnected(listener)`: the source was lost and is reached again, and change events may have been missed. It is never called for the first connection. `FeathersRecordSource` takes it from its `FeathersConnection`, which calls it for every connection made after the first. `MemoryRecordSource` has `disconnect()` and `reconnect()`, so a test can lose changes on purpose.

**The data manager syncs again.** On `onReconnected` a `DataManager` runs steps 1 to 3 of the startup sync again: it stops applying change events and records the IDs that change, fetches the snapshot with `find()`, and reconciles with `get(id)` until a round ends with nothing changed.

**It applies the difference, not the snapshot.** In one synchronous pass, the store is brought to what was fetched:

| the record is                | the store                  | the hook        |
| ---------------------------- | -------------------------- | --------------- |
| fetched and not in the store | `set`                      | `recordAdded`   |
| in both, and not equal       | `set`                      | `recordChanged` |
| in the store and not fetched | `remove`                   | `recordRemoved` |
| in both, and equal           | untouched: the same object | none            |

Records are compared in depth, by value. The hooks are called once the store holds every difference, as after the load: the removed records first, then the changed, then the added.

**A newer sync overtakes an older one.** A request that was under way when the connection dropped may never be answered. So each reconnect starts a new sync at once, and a sync that is no longer the latest applies nothing when it returns. This holds during `init()` as well: a reconnect during the load starts the load again, and `init()` ends with the one that completes.

**A failed resync keeps the store.** The store keeps what it holds, change events are applied again, and the next reconnect syncs again. The manager reports the failure through its `resyncFailed(error)` hook, which logs with `console.error` by default.

Rejected:

- **A `resync()` on `LiveSystem`, called by the application from its connection's listener.** Every application would have to remember the wiring, and `BaseManager` would gain a hook that only a `DataManager` uses.
- **Loading the snapshot whole, as at startup.** Every record would be reported as added and every watcher would react.
- **Replaying missed events.** The data service keeps no log of them ([ADR 007](007-data-service-source-of-truth.md)).
- **Retrying a failed resync on a timer.** It needs a clock and a policy for when to give up, for a case that is already rare. The next reconnect is the retry.

## Consequences

- After a lost connection the stores are correct again without a restart, on the server and in a web app alike: both get it from `DataManager`.
- A record that did not change keeps its object, its live object and its watchers undisturbed.
- A record removed and created again under the same ID while the connection was away is seen as one changed record, so its live object carries on with the new record.
- Until the resync completes, the store shows the state from before the connection was lost. The application shows the connection status itself.
- Records must be comparable by value: plain data, as a data service returns.
- Writes are not covered. A write made while the connection is away may be buffered by the transport and sent when it returns, after the resync. That is not designed yet.
- A resync that fails while the connection stays up is not tried again until the next reconnect.
