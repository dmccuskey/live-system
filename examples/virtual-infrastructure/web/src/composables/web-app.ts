// How a component reaches the web app.
import { inject } from 'vue'
import { WEB_APP } from '../app.ts'
import type { WebApp } from '../app.ts'

export function useWebApp(): WebApp {
    const app = inject(WEB_APP)

    if (!app) throw new Error('The web app is not provided: app.provide(WEB_APP, webApp)')

    return app
}
