// What the web app is told at run time by whatever serves it: a small JSON file beside the page.
import type { Fetch } from 'live-system/web'

/** A link out of the web app: what it says and where it leads. */
export interface WebLink {
    label: string
    url: string
}

/** The run-time configuration, as `/config.json` holds it. */
export interface WebConfig {
    /** The links of the "About" dialog, in the order given. The web app knows nothing of what they lead to. */
    links: WebLink[]
}

/** The configuration when there is none. */
export const emptyWebConfig = (): WebConfig => ({ links: [] })

/**
 * Reads the configuration. It never fails: a file that is missing, is not JSON
 * or holds something else gives an empty configuration, and the app runs without.
 * A link without a label, or without an address a browser can follow, is left out.
 */
export async function loadWebConfig(
    url: string,
    fetch: Fetch = (url, init) => globalThis.fetch(url, init),
): Promise<WebConfig> {
    try {
        const response = await fetch(url, { headers: { Accept: 'application/json' } })

        if (!response.ok) return emptyWebConfig()

        const { links } = (await response.json()) as { links?: unknown }

        return { links: Array.isArray(links) ? links.flatMap(toLink) : [] }
    } catch {
        return emptyWebConfig()
    }
}

/** The link in a one-element array, or an empty array for what is not a link. */
const toLink = (given: unknown): WebLink[] => {
    const { label, url } = (given ?? {}) as Record<string, unknown>

    if (typeof label !== 'string' || label.trim() === '' || !isWebAddress(url)) return []

    return [{ label: label.trim(), url }]
}

/** Only `http:` and `https:`: the address becomes a link's `href`. */
const isWebAddress = (value: unknown): value is string => {
    if (typeof value !== 'string') return false

    try {
        return ['http:', 'https:'].includes(new URL(value).protocol)
    } catch {
        return false
    }
}
