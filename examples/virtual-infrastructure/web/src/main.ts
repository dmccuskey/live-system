// The web app's entry. The data service and the live server must be running.
import { createApp } from 'vue'
import { createWebApp, WEB_APP } from './app.ts'
import App from './components/App.vue'

// All on the page's own origin: whatever serves the page (the dev server, or the server in front
// of a build) passes `/socket.io` on to the data service and `/command` on to the live server,
// and answers `/config.json` itself
const webApp = createWebApp({
    dataServiceUrl: location.origin,
    commandUrl: '/command',
    configUrl: '/config.json',
})

const app = createApp(App)

app.use(webApp.pinia)
app.provide(WEB_APP, webApp)

// Shown at once: the app renders from the status while the system starts
app.mount('#app')
webApp.start()
