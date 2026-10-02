# LiveSystem Demo Architecture

The design of the demonstration application in the LiveSystem repository. It is built on the primitives described in [Architecture](architecture.md): read that first.

## Overview

The demo is a **Virtual Infrastructure Simulator**.

Its purpose is not to model real cloud infrastructure accurately. Its purpose is to demonstrate the LiveSystem architecture through a continuously operating system.

The simulator contains two primary domains:

```text
Virtual Infrastructure
│
├── Users
└── Servers
```

## Users

Virtual users continuously generate commands.

Each user has a fixed behavioral profile:

```ts
interface VirtualUserProfile {
    commandsPerMinute: number

    commandMix: {
        search: number
        standard: number
        agentic: number
    }
}
```

The profile is generated when the user is created.

The Demo User can add or remove users but does not directly manipulate their generated behavioral characteristics in the initial version.

This intentional variability creates an unpredictable workload.

For example:

```text
Search
    low resource consumption
    short duration

Standard
    moderate resource consumption
    moderate duration

Agentic
    high resource consumption
    long duration
```

The system therefore produces changing infrastructure conditions without requiring the Demo User to manually generate every workload event.

## Virtual Users as Live Objects

A virtual user is an autonomous live object.

Its behavior includes:

```text
generate commands
       ↓
submit commands
       ↓
observe completion
       ↓
measure unmet demand
       ↓
update frustration
```

The UserManager owns the user's existence.

The User object owns the user's ongoing behavior.

This makes the simulator a concrete demonstration of LiveSystem's object model.

## Virtual Servers

Servers provide finite resources.

A server exposes:

```text
Capacity, in whole units
Current load
Active commands
```

There is one kind of capacity, not CPU, memory and storage apiece ([The Data Service](#the-data-service)).

Commands are routed to available servers.

Server load changes as commands begin and complete.

The exact resource simulation should remain deliberately simple and understandable.

The goal is to demonstrate dynamic behavior rather than create a production-grade infrastructure simulator.

## Server Management

The ServerManager supports two modes.

### Automatic

The ServerManager monitors infrastructure utilization and adds or removes servers according to a scaling policy.

The Demo User configures a maximum utilization threshold.

For example:

```text
Maximum utilization: 75%
```

If sustained utilization exceeds the threshold, the manager adds capacity.

If utilization remains sufficiently below the threshold, the manager may remove excess capacity.

Scale-up and scale-down thresholds should use hysteresis so that the system does not rapidly oscillate between adding and removing servers.

For example:

```text
Scale up:   > 75%
Scale down: < 35%
```

The exact values are configuration rather than architectural requirements.

The Demo User sets one value, the maximum utilization, from 30% to 95%. The lower mark follows it at a fixed gap of 40 points, and is never below 10%.

The manager samples the utilization once a second: the load over the capacity of the servers that take commands. "Sustained" is every sample of a window:

| Decision | When | Window |
|---|---|---|
| Add a server | every sample is above the maximum utilization, or commands wait for room | 5 s |
| Remove a server | every sample is below the lower mark, and no command waits for room | 15 s |

Commands that wait for room count as above the maximum whatever the load, because utilization stops at 100% and the queue is what shows demand beyond it. A command that waits for its own user's running commands is not counted: a further server would not start it.

Each decision begins both windows anew, so the next one needs a full window. Automatic scaling keeps from 1 to 8 servers.

Scaling down aborts nothing. An idle server is removed at once, the newest first. With none idle, the least loaded server is drained: it takes no new command, and is removed when its last one ends. Only one server leaves at a time. If more capacity is needed while a server drains, that server is taken back instead of a new one being added.

In automatic mode the add and remove commands are refused, with the error code `automatic_mode`.

### Manual

The Demo User controls the server population directly.

The UI provides:

```text
+ Add Server
- Remove Server
```

The user can therefore observe server utilization and decide when additional capacity is required.

A server removed by hand goes at once, and the commands it runs are aborted. A server that was draining when the mode changed to manual finishes draining.

The underlying server objects and command processing remain identical in both modes.

The difference is simply who makes the scaling decision.

## User Frustration

The simulator should model user experience rather than treating server utilization as the only important metric.

A user's expected throughput is based on their activity rate.

For example:

```text
Expected:
10 commands/minute

Actual:
6 commands/minute
```

The difference represents unmet demand.

Frustration increases as unmet demand persists and decreases as the system recovers.

Conceptually:

```text
expected throughput
        │
        ▼
   ┌──────────┐
   │  User    │
   └────┬─────┘
        │
        ▼
actual throughput
        │
        ▼
   unmet demand
        │
        ▼
    frustration
```

Frustration is therefore an emergent property of the system rather than a manually controlled variable.

This allows the demo to show that infrastructure health and user experience are related but not identical.

## The Data Service

The data service is a Feathers app in a process of its own, with a service per kind of record: `users`, `servers`, `settings` and `status`. The live server and the web app both connect to it over Socket.IO, and it publishes every change to every client.

It keeps the records in a SQLite file, one table per service, each record stored whole as JSON beside its ID. A record therefore gains a field without a change to the table. A record created without an `id` is given a UUID.

The record types are in the demo's protocol:

```ts
interface UserRecord {
    id: string
    name: string
    commandsPerMinute: number
    commandMix: { search: number; standard: number; agentic: number }
    frustration: number
}

interface ServerRecord {
    id: string
    name: string
    capacity: number
    load: number
    activeCommands: number
    isDraining: boolean
}

interface SettingsRecord {
    id: string
    key: string
    scalingMode: 'automatic' | 'manual'
    maxUtilization: number
}

interface StatusRecord {
    id: string
    key: string
    queueLength: number
    utilization: number
}
```

A user's command mix is three fractions that sum to 1, and its frustration runs from 0 to 1.

A server has one kind of capacity, counted in whole units, and a command costs a whole number of them. For example, a server of 10 units running one agentic command that costs 4 has a load of 4. Whole numbers are easier to reconcile by eye than fractions of a server.

A settings record belongs to one manager, and its `key` names that manager. There is one so far, with the key `servers`, for the `ServerManager`: the scaling mode and the maximum utilization, a fraction. A manager that gains settings gets a record of its own.

A status record holds what one manager reports of itself, and its `key` names that manager, the one that provides the data. There is one so far, with the key `servers`, for the `ServerManager`: the number of commands that wait in the queue, and the system utilization, which is the load of all servers over their capacity, a fraction from 0 to 1. A manager that gains a status gets a record of its own.

Both kinds of record are found by their `key`, never by their `id`: the ID is the data service's to give, as for every other record.

The service does not validate what it is given: only the live server writes to it.

## The Live Server

The live server is a process of its own: a `LiveSystem` with a `ServerManager`, a `UserManager`, a `SettingsManager` and a `StatusManager`, connected to the data service and taking commands over HTTP. It is the only writer of records.

There are two ways in, and they are kept apart:

```text
Demo User (UI)                         Virtual users (live objects)
      │                                        │
      │ commands, over HTTP                    │ events
      ▼                                        ▼
   Router                                  Event bus
      │                                        │
      ▼                                        ▼
UserManager, ServerManager              ServerManager ──▶ a VirtualServer
```

**Routes are for what the Demo User changes.** There are five, each with a command creator in the protocol:

| Route | Does |
|---|---|
| `users/add` | creates a user, with the next free name and a random profile |
| `users/:id/remove` | removes the user |
| `servers/add` | creates a server of 10 capacity units |
| `servers/:id/remove` | removes the server |
| `settings/:key/update` | changes the settings of the manager the key names: the scaling mode, the maximum utilization, or both |

The two server routes are refused in automatic mode.

**What the virtual users generate travels over the event bus.** A user and a server never know each other, and nothing calls a manager directly. The events are defined in the protocol's `events.ts`:

| Event | Emitted by | Means |
|---|---|---|
| `commandRequested` | a `VirtualUser` | the user wants a command run. It carries the command's ID, the user's ID and the type |
| `commandQueued` | the `ServerManager` | the command waits in the queue |
| `commandStarted` | the `VirtualServer` that took it | the command is running, and on which server |
| `commandRefused` | the `ServerManager` | the command will not be run, and why: `queue_full` when its user already has one waiting, `dropped` when it was waiting as its user was removed or the system stopped |
| `commandFinished` | the `VirtualServer` | the command left its server: `completed` after its duration, or `aborted` because the server was removed or the system stopped |
| `userRemoved` | the `UserManager` | a user is gone, so whatever of its waits can be dropped |
| `servers.queueChanged` | the `ServerManager` | the number of commands that wait has changed |
| `servers.utilizationChanged` | the `ServerManager` | the utilization of the servers as a whole has changed |

An event that reports a manager's own status is named after the manager, as the last two are, so that another manager's status can be told apart from it.

### Settings and Status

Each kind of record has one manager, and only that manager writes it. The `SettingsManager` owns the settings records and the `StatusManager` the status records. Neither is written for a single record: each holds one record per manager, found by its key.

**Settings travel through the store, not over the event bus.** Every store is a projection of the data service, and the settings store is no exception. The `settings/:key/update` route has the `SettingsManager` patch the record in the data service. The change comes back as an event of the service, and the `SettingsManager` writes it into the settings store. The `ServerManager` watches that store for the record with its key, `servers`, and takes its settings from there. The `SettingsManager` sees to it that the record is there before anything starts. Should it be missing all the same, for example deleted by hand in the data service during development, the `ServerManager` uses the defaults.

```text
UI ──▶ settings/servers/update ──▶ SettingsManager ──▶ data service
                                                           │ change event
                                                           ▼
                        ServerManager ◀── watches ── settings store
```

The stores are reached through the context, which holds the Pinia instance beside the event bus.

**Which records there must be is in the protocol.** `DEFAULT_SETTINGS` has the defaults of every settings key, and `INITIAL_STATUS` the status every key begins a run with. In its `init()`, once its records are loaded, each of the two managers goes through its table and creates the record of every key that has none. A new key without an entry in its table is a type error, so a record cannot be forgotten. A created record reaches the store with the data service's event, which may come after the answer to the create, so the `SettingsManager` waits in `init()` until the store has it. The same defaults are what a manager falls back on when its record is missing.

**Status goes the other way.** The `ServerManager` produces the queue's length and the utilization, yet it does not write the status record. It announces the queue's length as `servers.queueChanged` events and the utilization as `servers.utilizationChanged` events, which the `StatusManager` writes to the status record with the key `servers`, changes close together as one write.

The utilization in the status record covers every server, a draining one too. The utilization that automatic scaling samples leaves a draining server out, because its capacity is on its way out.

The order the managers are added in does not matter, because each phase has its work. A manager loads its records into its store in `init()`, begins to listen and to watch in `start()`, and acts in `run()`. The `ServerManager` begins to watch the settings store in its `start()`, when every store is loaded, and the virtual users send their first commands in their `run()`.

### How a Command Runs

A `VirtualUser`, once running, emits a `commandRequested` event at its record's rate. The requests are unevenly spaced around that rate, and each one's type is drawn from the user's command mix.

The `ServerManager` listens for the event and gives the command to the server with the most free capacity that can fit its cost. A server's load never exceeds its capacity: with no room anywhere, the command waits in the queue.

### The Queue

The `ServerManager` keeps one queue for all servers, in memory, and serves it from the front each time a command finishes or a server is added.

The order is strict: a command that waits for room keeps everything behind it waiting, even a smaller command that would fit now. Without this, small commands would keep taking the room as it comes free, and a large one could wait forever. With it, every command the queue accepts is run in the end.

Each user has two limits:

| Limit | Value | Beyond it |
|---|---|---|
| Commands running at once | 3 | the next one waits in the queue, until one of the user's own finishes |
| Commands waiting in the queue | 1 | the next one is refused |

A user refused once and refused again on every retry would never be served. The one place in the queue rules this out, and the queue is never longer than the number of users.

Three commands at once are what let a few users load a few servers: a single user can ask for up to 12 units, more than one server has. A command that waits for its own user, not for room, does not hold up the commands behind it.

A refused command is unmet demand, and so is the time a command spends waiting.

A `VirtualServer` keeps its active commands in memory and holds a timer for each. Its record holds only their count and the load they add up to, written shortly after each change, so that changes close together are one write. A restart therefore finds no command running, and each server clears what its record says of the earlier run.

The command types, with placeholder values to be tuned once the demo runs:

| Type | Cost | Duration |
|---|---|---|
| search | 1 unit | 2 s |
| standard | 2 units | 5 s |
| agentic | 4 units | 15 s |

### A First Start

With no server record at start, the `ServerManager` creates one, and with no user record the `UserManager` creates one. The `SettingsManager` creates the settings of every key from the protocol's defaults (for `servers`: automatic mode with a maximum utilization of 75%), and the `StatusManager` the status of every key. The system therefore works without any input.

## Demo User Interface

The Demo User interacts primarily with the environment.

Initial controls should include:

```text
Users
    [+ Add User]

Servers
    Mode: [Automatic | Manual]

    Maximum utilization: [slider]

    [In manual mode]
    [+ Add Server]
```

Each user has a direct remove control:

```text
Alice                              [-]
Bob                                [-]
Charlie                            [-]
```

The user profile displays:

```text
Alice

Activity:       8 commands/min
Search:         70%
Standard:       20%
Agentic:        10%

Frustration:    14%
```

The command mix is visible but not editable in the initial version.

Later versions may allow the activity rate to be adjusted with a slider.

The command mix should remain fixed initially so that changing infrastructure produces interesting behavior without giving the Demo User direct control over every variable.

## Demonstration Goals

The demo should make several architectural properties observable.

### Autonomous Behavior

The system continues doing work even when the Demo User does nothing.

### Dynamic Object Creation

Users and servers can appear and disappear while the system is running.

### Long-Lived State

Objects maintain state across many interactions.

### Event-Driven Behavior

Changes in one part of the system cause other components to react.

### Command Routing

Generated commands are routed to available resources.

### Resource Constraints

Finite server capacity affects system behavior.

### Autonomous Management

The ServerManager can observe conditions and make scaling decisions.

### Emergent Behavior

Randomized user activity and differing command costs create changing conditions.

### Reactive Presentation

The UI continuously reflects the state of the running system.
