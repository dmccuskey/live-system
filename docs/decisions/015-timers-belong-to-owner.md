# ADR 015: No Scheduler: Timers Belong to Their Owner

**Status:** Accepted

## Context

Live objects do things over time: a virtual user issues a command every few seconds, a manager checks utilization at an interval. A framework could offer a shared scheduler that all of them register work with.

A scheduler adds a part that every object depends on, and it separates a piece of work from the object that owns it.

## Decision

- There is no shared scheduler. Objects and managers use the platform's timers.
- A timer belongs to the object or manager that does the work. Its owner stops it in `destroy()` or `stop()` ([ADR 002](002-managers-own-existence.md)).
- Every timer callback handles its own errors. An error in a callback must not escape into the platform.
- Timers are local and in memory. Their handles are not stored in records ([ADR 016](016-records-hold-live-state.md)).

Rejected:

- **A shared scheduling primitive.** Not until several owners need the same thing. A helper can be added then, from real uses.

## Consequences

- Nothing new to learn: a timer is a timer.
- Stopping an object stops its work, because the object holds the timer.
- Each owner repeats a few lines for starting, stopping and error handling.
- There is no single place that lists what is scheduled.
