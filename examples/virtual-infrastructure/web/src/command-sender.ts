// The CommandSender: sends the UI's commands and keeps the last failure for the UI to show.
import { CommandError } from 'live-system/core'
import type { Command } from 'live-system/core'
import type { CommandClient } from 'live-system/web'
import { readonly, ref } from 'vue'
import type { Ref } from 'vue'

/** How long a failure is shown, in milliseconds, unless given. */
export const ERROR_DURATION = 6_000

export interface CommandSender {
    /** Why the last command failed, until it is dismissed or its time is up. */
    readonly error: Readonly<Ref<string | undefined>>
    /** Sends the command. Resolves with whether the server accepted it, and never rejects: a failure is in `error`. */
    send(command: Command): Promise<boolean>
    /** Clears the failure. */
    dismiss(): void
}

export function createCommandSender(
    client: Pick<CommandClient, 'send'>,
    errorDuration = ERROR_DURATION,
): CommandSender {
    const error = ref<string>()
    let timer: ReturnType<typeof setTimeout> | undefined

    function dismiss(): void {
        clearTimeout(timer)
        timer = undefined
        error.value = undefined
    }

    return {
        error: readonly(error),
        dismiss,

        async send(command) {
            try {
                await client.send(command)

                return true
            } catch (cause) {
                dismiss()
                error.value = cause instanceof CommandError ? cause.message : String(cause)
                timer = setTimeout(dismiss, errorDuration)

                return false
            }
        },
    }
}
