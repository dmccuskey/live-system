// The live server's process: `bun run start`. The data service must be running.
import { DATA_SERVICE_PORT, LIVE_SERVER_PORT } from '@virtual-infrastructure/protocol/services'
import { createLiveServer } from './app.ts'

const dataServiceUrl = process.env.DATA_SERVICE_URL ?? `http://localhost:${DATA_SERVICE_PORT}`
const port = Number(process.env.LIVE_SERVER_PORT ?? LIVE_SERVER_PORT)

const liveServer = createLiveServer({ dataServiceUrl, port })

console.log(`Live server taking commands on port ${await liveServer.start()}, records from ${dataServiceUrl}`)

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, async () => {
        await liveServer.stop()
        process.exit(0)
    })
}
