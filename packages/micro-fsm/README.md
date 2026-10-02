# Micro FSM

A small asynchronous state machine for TypeScript, with no dependencies.

You list the states, say where each may be entered from, and give each an `enter` to do its work. The machine holds the current state and refuses a transition that is not legal.

```ts
import { StateMachine } from 'micro-fsm'

type State = 'idle' | 'loading' | 'loaded' | 'failed'

const machine = new StateMachine<State>({
    initial: 'idle',
    states: {
        loading: { from: ['idle', 'failed'] },
        loaded: {
            from: 'loading',
            enter: async () => {
                await fetchTheData()
            }
        },
        failed: { from: 'loading' }
    }
})

await machine.transition('loading')
await machine.transition('loaded') // waits for fetchTheData()

machine.state // 'loaded'
```

## Features

- The configuration is keyed by destination state: each state says where it may be entered `from`.
- `from` is one state, several, or `'*'` for any.
- `enter` and `leave` may be asynchronous. `transition()` waits for them.
- The state changes only after `leave` and `enter` succeed. If one fails, the state is unchanged and the error reaches the caller.
- One transition at a time: a second one started before the first has finished is refused.
- The states are a TypeScript union, so a misspelled state is a compile error.
- No dependencies.

It has no history, hierarchy, guard language, generated transition methods or visualization. For those, use a statechart library.

## Quick Start

The following steps take about five minutes, on any system with [Bun](https://bun.sh). You will have a machine that makes a transition and refuses one.

Prerequisite: Bun (`bun --version`).

The package is not published yet. It is part of the [LiveSystem](../../README.md) workspace, so the steps run inside a clone of it.

1. In the clone, install the workspace:

    ```sh
    bun install
    ```

2. Save this as `packages/micro-fsm/try.ts`:

    ```ts
    import { StateMachine, TransitionError } from 'micro-fsm'

    type State = 'closed' | 'open' | 'locked'

    const door = new StateMachine<State>({
        initial: 'closed',
        states: {
            open: { from: 'closed', enter: () => console.log('opening') },
            closed: { from: 'open' },
            locked: { from: 'closed' }
        }
    })

    await door.transition('open')
    console.log(door.state)

    try {
        await door.transition('locked')
    } catch (error) {
        if (error instanceof TransitionError) console.log(error.message)
    }
    ```

3. Run it:

    ```sh
    bun packages/micro-fsm/try.ts
    ```

    ```text
    opening
    open
    Cannot transition from 'open' to 'locked'
    ```

    `Cannot find package 'micro-fsm'` means step 1 was skipped, or the file is outside the workspace.

Delete `try.ts` when you are done.

## Reference

| | |
|---|---|
| [`new StateMachine(config)`](#configuration) | creates a machine in its `initial` state |
| [`machine.state`](#state) | the current state |
| [`machine.is(state)`](#is) | whether the machine is in `state` |
| [`machine.can(target)`](#can) | whether `transition(target)` would be accepted now |
| [`await machine.transition(target)`](#transition) | moves to `target` |
| [`TransitionError`](#transitionerror) | thrown when a transition is refused |

### Configuration

```ts
new StateMachine<State>({
    initial: 'created',
    states: {
        ready: {
            from: 'created',
            enter: async ({ from, to }) => {},
            leave: async ({ from, to }) => {}
        }
    }
})
```

- `initial`: the state the machine starts in. Its `enter` does not run.
- `states`: keyed by state. Every key is optional, and so is every field:
    - `from`: the states this one may be entered from: one state, an array of them, or `'*'` for any. A state with no `from`, or with no entry in `states`, can't be entered. That suits an initial state the machine never returns to.
    - `enter`: runs before the machine enters this state.
    - `leave`: runs before the machine leaves this state.

Both hooks receive `{ from, to }` and may return a promise. A state may be entered from itself only if its `from` includes it (or is `'*'`).

### state

The current state. While a transition is in progress it is still the state being left: it changes once, after the hooks have succeeded.

### is

`machine.is('ready')` is `machine.state === 'ready'`.

### can

`machine.can(target)` is `true` when `transition(target)` would be accepted: `target`'s `from` allows the current state, and no transition is in progress. It runs no hooks.

### transition

`await machine.transition(target)` does this, in order:

1. Refuses, with a [`TransitionError`](#transitionerror), if another transition is in progress or `target`'s `from` does not allow the current state. No hook runs.
2. Awaits the current state's `leave`.
3. Awaits `target`'s `enter`.
4. Sets the state to `target`.

If `leave` or `enter` throws or rejects, the later steps do not run, the state is unchanged, and `transition()` rejects with that same error. The transition can then be tried again.

A hook must not call `transition()` and wait for it: the machine is still in the transition the hook belongs to, so the call is refused. Make the transitions one after another from outside:

```ts
await machine.transition('ready')
await machine.transition('running')
```

### TransitionError

An `Error` with:

- `from`: the state the machine was in.
- `to`: the state asked for.
- `reason`: `'not-allowed'` (`from` does not allow it) or `'in-transition'` (another transition is in progress).

An error thrown by a hook is not wrapped in a `TransitionError`.

## Why Micro FSM?

Tiny FSM was taken.

## License

MIT, as the [LiveSystem repository](../../LICENSE).
