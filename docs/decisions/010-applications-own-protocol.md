# ADR 010: Applications Own Their Protocol

**Status:** Accepted

## Context

A server and its web apps must agree on the records, commands, events, routes and constants they exchange. That shared vocabulary has to live somewhere both sides can import it.

It is tempting to give the framework a `shared` or `protocol` package. But the vocabulary is the application's: a trading application and an infrastructure simulator share none of it.

An earlier prototype kept a shared folder and copied it between two repositories with a script.

## Decision

> LiveSystem provides the grammar. The application provides the language.

- An application defines its records, commands, events, routes and constants in a `protocol` package of its own, imported by its server and its web apps.
- The protocol is organized by domain, one folder each, holding that domain's record types, route patterns, commands and constants. A manager owns one domain, so what it needs sits together.
- Route patterns are defined once in the protocol, as constants. The server's managers use them in `routes()`, and the web uses them to build commands, so the two cannot disagree on a route.
- The protocol also holds the application's command creators: small functions that build a command from typed arguments, filling the route's parameters.

  ```ts
  const restartServer = (id: string, data: RestartOptions): Command<RestartOptions> => ({
      route: fillRoute(Routes.restartServer, { id }),   // 'server/:id/restart'
      data
  })
  ```

- LiveSystem has no `shared` or `protocol` package, and contains no application vocabulary.
- Where an application's server and web apps share a workspace, the protocol package is an ordinary workspace dependency.

Rejected:

- **A shared folder copied between repositories by script.** The copies drift, and nothing checks that they match.
- **Git submodules.** They add steps to every change for a client and server that always change together.
- **A published shared package.** Publishing a version for each change is too heavy for a tightly coupled pair.
- **Generated types from a schema or an API description.** Possibly later; the hand-written types are enough for now.

## Consequences

- LiveSystem stays free of any application's concepts, including the demo's ([ADR 012](012-bun-workspace-and-demo.md)).
- A change to a command or a record is one change, checked by the compiler on both sides.
- It assumes server and web are developed together. Independent clients would need a published protocol.
