# ADR 003: An Explicit Async Lifecycle With a Ready State

**Status:** Accepted

## Context

A live system must bring its parts up in order: connect to its infrastructure, load data, start activity, then run. An earlier prototype had `created`, `initialized`, `started` and `running`, with two problems:

- It waited a fixed 500 ms before initializing, in place of knowing that the data service was connected.
- Each manager reported its ID back to a pending list when it finished a phase. A manager whose hook failed never reported, so startup waited forever.

## Decision

The lifecycle is:

```text
created → ready → initialized → started → running → stopped
```

- `created`: the system exists and its managers have been added.
- `ready`: the infrastructure is connected. For a Feathers data service, this is the connection's own ready signal, not elapsed time.
- `initialized`: managers have loaded their initial state.
- `started`: managers have started their activity: subscriptions, timers, live objects.
- `running`: the system is operating.
- `stopped`: activity has ended and resources are released.

Each phase is an awaited async operation. The promise is the completion signal: when it resolves the phase is done, and when it rejects the phase has failed and startup fails with it ([ADR 014](014-failure-and-shutdown.md)).

States are end states. The active forms ("starting", "stopping") are the transitions between them, so there is no `stopping` state.

A manager can rely on one rule: when its `init()` is called, the system's infrastructure is ready.

Rejected:

- **A fixed startup delay.** It is too short on a slow machine and wasted on a fast one.
- **Managers reporting completion to a pending list.** A failure is indistinguishable from slowness.

The set of states is kept loose for now and may change as the implementation proceeds.

## Consequences

- Startup either completes or fails with the error that caused it. It cannot hang on a failed hook.
- No manager needs to wait for, or check, the connection.
- A deliberate pause between phases is still possible as ordinary code, but never as a stand-in for readiness.
- How the lifecycle is driven is in [ADR 004](004-lifecycle-runner-and-state-machine.md).
