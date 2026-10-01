# LiveSystem Documentation

New to LiveSystem? Start with the [README](../README.md). LiveSystem is at the design stage, so these pages describe what will be built.

## Internals

- [Architecture](architecture.md): the primitives, the lifecycle, managers, live objects, record sources, commands and events, and the planned package structure
- [Demo Architecture](architecture-demo.md): the Virtual Infrastructure Simulator, the demo application that proves the design
- [Architecture Decisions](decisions/): the decision records (ADRs): why the design is what it is, and what was rejected

## Contribute

- [Development](development.md): possible future changes; the build and test workflow will be added with the code

## Project Structure

```text
live-system/
├── docs/
│   ├── README.md               # this page
│   ├── architecture.md         # the design of LiveSystem
│   ├── architecture-demo.md    # the design of the demo application
│   ├── development.md          # possible future changes
│   └── decisions/              # ADRs
├── LICENSE
└── README.md
```
