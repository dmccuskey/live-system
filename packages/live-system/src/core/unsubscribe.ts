/**
 * Ends a subscription. Whatever subscribes keeps the function it was given and
 * calls it at the end of its own life: a manager in `stop()`, a live object in
 * `destroy()`.
 */
export type Unsubscribe = () => void
