// The context: the one object the web app's managers share.
import type { Pinia } from 'pinia'

export interface WebContext {
    /** The local reactive state: a store per kind of record, each a projection of the data service. */
    pinia: Pinia
}
