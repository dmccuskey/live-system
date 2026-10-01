# ADR 014: Failure and Shutdown

**Status:** Accepted

## Context

A long-lived system fails in different places, and each needs a defined outcome: a manager during startup, a live object while running, a command, and the system as it shuts down. Actor systems answer this with supervision trees and restart policies; [ADR 001](001-long-lived-managed-objects.md) chose not to be one.

In an earlier prototype a manager whose startup hook failed was logged and startup waited forever.

## Decision

**A manager fails during startup.** The phase fails, and startup fails with it ([ADR 003](003-explicit-async-lifecycle.md)). What had already started is cleaned up, as in shutdown. `boot()` rejects with the error.

**A live object fails.** The failure is isolated to that object: it is reported, the object is disposed of, and its manager decides what follows. Other objects are not affected.

**A command fails.** The sender receives a response with a structured error (`CommandError`): a name, a message and a code, not a bare exception. An unknown route is such an error ([ADR 009](009-commands-events-crud.md)).

**Shutdown.** `system.shutdown()` moves the system to `stopped`:

```text
system.shutdown()
    │
    ▼
lifecycle.transition('stopped')  → system.stopManagers()
```

- Managers are stopped in the reverse of the order they were added, so a manager that depends on one added earlier is stopped first.
- Each manager's `stop()` is awaited. It removes its subscriptions, stops its timers and destroys its live objects ([ADR 002](002-managers-own-existence.md)).
- The system then closes its infrastructure connections.
- Shutdown is idempotent: calling it again does nothing.

**No automatic retries.** LiveSystem does not restart a failed manager or object, or repeat a failed command.

Rejected:

- **Supervision trees and restart policies in the framework.** They are the machinery of an actor system. An application that wants a retry writes it where it knows what retrying means.

## Consequences

- Every failure has one defined outcome, and none of them is waiting forever.
- A failed startup leaves nothing running.
- One misbehaving object does not take down its manager or the system.
- Recovery is the application's responsibility. A system that must heal itself has to build that.
- The order managers are added in is significant, and the application chooses it.
