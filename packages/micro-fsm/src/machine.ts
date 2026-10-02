// A small asynchronous state machine. No dependencies.

/** What a hook is told about the transition it is part of. */
export interface Transition<S extends string> {
    from: S
    to: S
}

export type Hook<S extends string> = (transition: Transition<S>) => void | Promise<void>

/** The states a state may be entered from: one, several, or `'*'` for any. */
export type From<S extends string> = S | readonly S[] | '*'

export interface StateConfig<S extends string> {
    /** Where this state may be entered from. Without it, the state can't be entered. */
    from?: From<S>
    /** Runs before the machine enters this state. If it fails, the state doesn't change. */
    enter?: Hook<S>
    /** Runs before the machine leaves this state. If it fails, the state doesn't change. */
    leave?: Hook<S>
}

export interface MachineConfig<S extends string> {
    initial: S
    /** Keyed by destination state. */
    states: { readonly [K in S]?: StateConfig<S> }
}

export type TransitionErrorReason = 'not-allowed' | 'in-transition'

/** Thrown when a transition is refused. A failing hook's own error is passed on as it is. */
export class TransitionError<S extends string = string> extends Error {
    readonly from: S
    readonly to: S
    readonly reason: TransitionErrorReason

    constructor(from: S, to: S, reason: TransitionErrorReason) {
        super(
            reason === 'in-transition'
                ? `Cannot transition to '${to}': another transition is in progress`
                : `Cannot transition from '${from}' to '${to}'`,
        )
        this.name = 'TransitionError'
        this.from = from
        this.to = to
        this.reason = reason
    }
}

export class StateMachine<S extends string> {
    #state: S
    #states: MachineConfig<S>['states']
    #transitioning = false

    constructor(config: MachineConfig<S>) {
        this.#state = config.initial
        this.#states = config.states
    }

    /** The current state. During a transition it is still the state being left. */
    get state(): S {
        return this.#state
    }

    is(state: S): boolean {
        return this.#state === state
    }

    /** Whether `transition(target)` would be accepted right now. */
    can(target: S): boolean {
        return !this.#transitioning && this.#allowed(target)
    }

    /**
     * Checks `from`, awaits the current state's `leave` and the target's `enter`,
     * then sets the state. If either hook fails, the state is unchanged and the
     * error is passed on.
     */
    async transition(target: S): Promise<void> {
        const from = this.#state

        if (this.#transitioning) throw new TransitionError(from, target, 'in-transition')
        if (!this.#allowed(target)) throw new TransitionError(from, target, 'not-allowed')

        const transition: Transition<S> = { from, to: target }

        this.#transitioning = true
        try {
            await this.#states[from]?.leave?.(transition)
            await this.#states[target]?.enter?.(transition)
            this.#state = target
        } finally {
            this.#transitioning = false
        }
    }

    #allowed(target: S): boolean {
        // hasOwn: a state named like an Object.prototype member is not configured
        if (!Object.hasOwn(this.#states, target)) return false

        const from: From<S> | undefined = this.#states[target]?.from

        if (from === undefined) return false
        if (from === '*') return true
        if (typeof from === 'string') return from === this.#state

        return from.includes(this.#state)
    }
}
