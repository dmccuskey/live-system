// The data service's paths, one per kind of record.
export const SERVICES = {
    users: 'users',
    servers: 'servers',
} as const

/** The port the data service listens on, unless it is started with another. */
export const DATA_SERVICE_PORT = 3030
