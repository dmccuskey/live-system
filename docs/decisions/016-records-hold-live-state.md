# ADR 016: Records Hold the Live State

**Status:** Accepted

## Context

A live object has state that changes as the system runs: what it is doing, how loaded it is, what work is pending. The question is where that state lives.

One answer is to keep it in memory only, with records holding just an object's definition, and to re-create the runtime state after a restart. That answer was proposed during the design and rejected: in this architecture the web sees the system only through the data service ([ADR 007](007-data-service-source-of-truth.md)), so state that is not in a record cannot be displayed.

## Decision

A live object's record in the data service is its runtime state, not only its definition.

- **What a record holds.** Current activity, utilization, pending work, and other values the live objects produce as the system runs. It is mostly what the front end displays, plus data the object needs behind the scenes.
- **Who writes it.** The object writes its own record through the data service, following the write rules of [ADR 007](007-data-service-source-of-truth.md).
- **Restart.** On startup the managers rehydrate their live objects from the records.
- **Timers.** Timers are local to the object and in memory; their handles are not stored ([ADR 015](015-timers-belong-to-owner.md)). A record holds timing data only when a timer must be re-created from it, for example a last-refresh time.
- **When updates are written.** As soon as they happen. An application may debounce where its use calls for it, and `core` offers a small utility for that. Debouncing is opt-in, never the default.
- **Configuration is separate.** Settings that control the managers (a scaling mode, a utilization limit, a maximum number of servers) are not live state. A small project keeps them in a file. A larger one keeps them in a configuration service with one record per manager, keyed by the manager's name, so they can be changed on the running system.

Rejected:

- **Runtime state kept only in memory**, with records holding definitions. The web could not show it, and a restart would lose it.

## Consequences

- The web shows the live state of the system with no extra channel: it mirrors the records.
- A command's progress and result are visible the same way ([ADR 009](009-commands-events-crud.md)).
- A restarted system resumes from where the records say it was.
- The data service carries every state change, so a busy object produces many writes. Debouncing is the tool when that matters.
- Records change shape as the live objects evolve, more often than a definition would.
