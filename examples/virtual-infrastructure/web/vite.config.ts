import { DATA_SERVICE_PORT, LIVE_SERVER_PORT, WEB_PORT } from '@virtual-infrastructure/protocol/services'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'
import type { Plugin } from 'vite'

const dataServiceUrl = process.env.DATA_SERVICE_URL ?? `http://localhost:${DATA_SERVICE_PORT}`
const liveServerUrl = process.env.LIVE_SERVER_URL ?? `http://localhost:${LIVE_SERVER_PORT}`

// The run-time configuration, which the server in front of a build answers in the same way: the
// links of the "About" dialog, each from a pair of variables, `ABOUT_LINK_1_LABEL` and
// `ABOUT_LINK_1_URL` up to 4. The web app leaves out a link that lacks either
const config = (): Plugin => ({
    name: 'web-config',
    configureServer(server) {
        server.middlewares.use('/config.json', (_request, response) => {
            const links = [1, 2, 3, 4].map(n => ({
                label: process.env[`ABOUT_LINK_${n}_LABEL`] ?? '',
                url: process.env[`ABOUT_LINK_${n}_URL`] ?? '',
            }))

            response.setHeader('Content-Type', 'application/json')
            response.end(JSON.stringify({ links }))
        })
    },
})

export default defineConfig({
    plugins: [vue(), config()],
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
