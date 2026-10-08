// The data service's process: `bun run start`.
import { join } from 'node:path'
import { DATA_SERVICE_PORT } from '@virtual-infrastructure/protocol/services'
import { createDataService } from './app.ts'

const port = Number(process.env.DATA_SERVICE_PORT ?? DATA_SERVICE_PORT)
const filename = process.env.DATA_SERVICE_DB ?? join(import.meta.dir, '..', 'data', 'virtual-infrastructure.sqlite')

// Unset or empty: every client may write
const writeToken = process.env.DATA_SERVICE_WRITE_TOKEN || undefined

const dataService = createDataService({ port, filename, writeToken })

console.log(`Data service listening on port ${await dataService.start()}, records in ${filename}`)
if (writeToken) console.log('The records are read-only without the write token')

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, async () => {
        await dataService.stop()
        process.exit(0)
    })
}
