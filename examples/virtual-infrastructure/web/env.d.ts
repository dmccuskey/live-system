/// <reference types="vite/client" />

interface ImportMetaEnv {
    /** The data service's address. The page's host on the data service's port, unless given. */
    readonly VITE_DATA_SERVICE_URL?: string
}
