# ADR 001: Long-Lived Managed Objects, Not Actors

**Status:** Accepted

## Context

LiveSystem is for applications that keep running and keep state: objects that do work on their own, react to changes, and exist across many interactions. Several established models address this, and each was considered:

- **Actor systems** (Akka, Erlang/OTP, Orleans) give every entity a mailbox, isolate failures with supervision trees, and distribute entities across machines.
- **Durable workflow engines** (Temporal) persist the steps of a workflow so it survives restarts.
- **Request-centric frameworks** (Nest, MVC) organize an application around handlers for incoming requests.
- **CQRS** separates commands from queries as the shape of the whole application.

An earlier prototype showed that the applications in question run in one process and need none of the distribution, mailboxes or supervision that those models bring. What they need is small: something to start and stop the system in order, something to own the objects, a way to ask the system to do things, and a way to hear what happened.

## Decision

A LiveSystem application is one process holding ordinary objects that stay alive.

- Objects call each other directly, with normal method calls and normal exceptions. There are no mailboxes and no message passing between objects.
- The runtime is small: a lifecycle ([ADR 003](003-explicit-async-lifecycle.md), [ADR 004](004-lifecycle-runner-and-state-machine.md)), managers that own objects ([ADR 002](002-managers-own-existence.md)), a command router and events ([ADR 009](009-commands-events-crud.md)).
- LiveSystem does not distribute objects across processes or machines, and does not persist workflows.

## Consequences

- The code reads as ordinary TypeScript. A stack trace shows what called what.
- The framework stays small enough to read in one sitting.
- One process is the limit. An application that must spread live objects over several machines needs an actor system instead.
- Failure isolation is by convention, not by the runtime: see [ADR 014](014-failure-and-shutdown.md).
- Commands and events are used ([ADR 009](009-commands-events-crud.md)) without making CQRS the architecture.
