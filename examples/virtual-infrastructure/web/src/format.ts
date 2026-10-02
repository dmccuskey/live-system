// How the UI words its numbers.

/** A fraction as a whole percentage: 0.756 is "76%". */
export function percent(fraction: number): string {
    return `${Math.round(fraction * 100)}%`
}

export type Mood = 'calm' | 'uneasy' | 'annoyed' | 'angry'

/** Which quarter of 0 to 1 a user's frustration is in, for the color of its bar: green, yellow, orange, red. */
export function mood(frustration: number): Mood {
    if (frustration < 0.25) return 'calm'
    if (frustration < 0.5) return 'uneasy'
    if (frustration < 0.75) return 'annoyed'

    return 'angry'
}

export type Level = 'low' | 'medium' | 'high'

/** Which third of 0 to 1 a fraction is in, for the color of a bar. */
export function level(fraction: number): Level {
    if (fraction < 1 / 3) return 'low'
    if (fraction < 2 / 3) return 'medium'

    return 'high'
}
