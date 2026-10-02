// The data service's paths, one per kind of record.
export const SERVICES = {
    users: 'users',
    servers: 'servers',
    settings: 'settings',
    status: 'status',
} as const

/** The port the data service listens on, unless it is started with another. */
export const DATA_SERVICE_PORT = 3030

/** The port the live server takes commands on, unless it is started with another. */
export const LIVE_SERVER_PORT = 3031
