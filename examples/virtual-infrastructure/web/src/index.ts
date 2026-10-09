// The web app: a display of what happens on the server. It sends commands and never writes records.
export { createWebApp, WEB_APP, type WebApp, type WebAppOptions } from './app.ts'
export { createCommandSender, type CommandSender } from './command-sender.ts'
export { loadWebConfig, type WebConfig, type WebLink } from './config.ts'
export type { WebContext } from './context.ts'
export { ManagerRecords, ServerManager, UserManager } from './managers.ts'
