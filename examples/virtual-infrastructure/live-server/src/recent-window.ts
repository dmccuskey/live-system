// RecentWindow: what happened within a span of time before now.

/**
 * Keeps values with the moment each was added, and gives those no older than
 * its span. It holds no timer: whoever uses it says what time it is, and asks
 * `untilNext()` when to look again.
 */
export class RecentWindow<T> {
    #span: number
    // The oldest first
    #entries: { at: number; value: T }[] = []

    /** `span` is how far back the window looks, in milliseconds. */
    constructor(span: number) {
        this.#span = span
    }

    add(now: number, value: T): void {
        this.#entries.push({ at: now, value })
    }

    /** The values added less than the span ago, the oldest first. */
    values(now: number): T[] {
        this.#prune(now)

        return this.#entries.map(entry => entry.value)
    }

    /** How long until the oldest value leaves the window, in milliseconds. With none, `undefined`. */
    untilNext(now: number): number | undefined {
        this.#prune(now)

        const oldest = this.#entries[0]

        return oldest && oldest.at + this.#span - now
    }

    clear(): void {
        this.#entries = []
    }

    // By the same sum as untilNext(), so that a value still here always has time left: with
    // fractions of a millisecond, `now - at < span` can hold where `at + span - now` is 0
    #prune(now: number): void {
        const first = this.#entries.findIndex(entry => entry.at + this.#span - now > 0)

        this.#entries = first === -1 ? [] : this.#entries.slice(first)
    }
}
