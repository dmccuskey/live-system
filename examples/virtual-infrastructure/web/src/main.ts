// The web app's entry: `bun run dev`. The data service and the live server must be running.
import { DATA_SERVICE_PORT } from '@virtual-infrastructure/protocol/services'
import { createApp } from 'vue'
import { createWebApp, WEB_APP } from './app.ts'
import App from './components/App.vue'

const webApp = createWebApp({
    dataServiceUrl: import.meta.env.VITE_DATA_SERVICE_URL ?? `http://${location.hostname}:${DATA_SERVICE_PORT}`,
    // Same origin: the dev server passes it on to the live server
    commandUrl: '/command',
})

const app = createApp(App)

app.use(webApp.pinia)
app.provide(WEB_APP, webApp)

// Shown at once: the app renders from the status while the system starts
app.mount('#app')
webApp.start()
