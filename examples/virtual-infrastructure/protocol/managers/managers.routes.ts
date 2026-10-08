// The command routes of the managers domain.
// Each manager takes the route with its own key: the `ServerManager` takes `managers/servers/update`.
export const MANAGER_ROUTES = {
    update: 'managers/:key/update',
} as const
