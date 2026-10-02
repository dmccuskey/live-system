import { LIVE_SERVER_PORT, WEB_PORT } from '@virtual-infrastructure/protocol/services'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

const liveServerUrl = process.env.LIVE_SERVER_URL ?? `http://localhost:${LIVE_SERVER_PORT}`

export default defineConfig({
    plugins: [vue()],
    server: {
        port: Number(process.env.WEB_PORT ?? WEB_PORT),
        strictPort: true,
        // The CommandServer sends no CORS headers, so the browser posts its commands here
        proxy: { '/command': liveServerUrl },
    },
})
