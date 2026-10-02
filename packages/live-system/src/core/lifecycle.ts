// The lifecycle: its states, and the runner that takes a system through them.
import { StateMachine } from 'micro-fsm'

export type LifecycleState = 'created' | 'ready' | 'initialized' | 'started' | 'running' | 'stopped'

/** The owner of the lifecycle, which the runner calls back into for the work of each state. */
export interface LifecycleOwner {
    /** Connects the infrastructure. When it resolves, the system is ready. */
    connect(): void | Promise<void>
    initManagers(): void | Promise<void>
    startManagers(): void | Promise<void>
    runManagers(): void | Promise<void>
    /** Stops whatever has started. Called from any state, so also after a failed startup. */
    stopManagers(): void | Promise<void>
}

/**
 * Takes a system from `created` to `running` one transition at a time, and to
 * `stopped` on shutdown. Each transition waits for its work before the next.
 */
export class LifecycleRunner {
    #machine: StateMachine<LifecycleState>

    constructor(owner: LifecycleOwner) {
        this.#machine = new StateMachine<LifecycleState>({
            initial: 'created',
            states: {
                ready: { from: 'created', enter: () => owner.connect() },
                initialized: { from: 'ready', enter: () => owner.initManagers() },
                started: { from: 'initialized', enter: () => owner.startManagers() },
                running: { from: 'started', enter: () => owner.runManagers() },
                stopped: {
                    from: ['created', 'ready', 'initialized', 'started', 'running'],
                    enter: () => owner.stopManagers(),
                },
            },
        })
    }

    /** The current state. During a transition it is still the state being left. */
    get state(): LifecycleState {
        return this.#machine.state
    }

    /**
     * Makes the startup transitions in order. If a state's work fails, the
     * advance stops there: the state is the last one reached, and the error is
     * passed on.
     */
    async run(): Promise<void> {
        await this.#machine.transition('ready')
        await this.#machine.transition('initialized')
        await this.#machine.transition('started')
        await this.#machine.transition('running')
    }

    /** Moves to `stopped`, from any state. Once stopped, calling it again does nothing. */
    async stop(): Promise<void> {
        if (this.#machine.is('stopped')) return

        await this.#machine.transition('stopped')
    }
}
