import { DATA_SERVICE_PORT, LIVE_SERVER_PORT, WEB_PORT } from '@virtual-infrastructure/protocol/services'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

const dataServiceUrl = process.env.DATA_SERVICE_URL ?? `http://localhost:${DATA_SERVICE_PORT}`
const liveServerUrl = process.env.LIVE_SERVER_URL ?? `http://localhost:${LIVE_SERVER_PORT}`

export default defineConfig({
    plugins: [vue()],
    server: {
        port: Number(process.env.WEB_PORT ?? WEB_PORT),
        strictPort: true,
        // The web app talks to its own origin only, so the dev server passes both on
        proxy: {
            '/socket.io': { target: dataServiceUrl, ws: true },
            '/command': liveServerUrl,
        },
    },
})
