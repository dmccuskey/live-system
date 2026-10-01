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

A server might expose:

```text
CPU capacity
Memory capacity
Storage capacity
Current utilization
Active commands
```

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

### Manual

The Demo User controls the server population directly.

The UI provides:

```text
+ Add Server
- Remove Server
```

The user can therefore observe server utilization and decide when additional capacity is required.

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
