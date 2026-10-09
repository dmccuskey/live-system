<script setup lang="ts">
// What this demo is, in a dialog over the page. Its links out are the ones the web app was given at run time.
import { ref } from 'vue'
import { useWebApp } from '../composables/web-app.ts'

const { config } = useWebApp()
const dialog = ref<HTMLDialogElement>()

// A click on the backdrop lands on the dialog itself, a click inside lands on its content
const closeOnBackdrop = (event: MouseEvent) => {
    if (event.target === dialog.value) dialog.value.close()
}
</script>

<template>
    <button type="button" class="open" data-test="about-open" @click="dialog?.showModal()">About</button>

    <dialog ref="dialog" class="about" aria-labelledby="about-title" data-test="about" @click="closeOnBackdrop">
        <div class="about__content">
            <h2 id="about-title">About this demo</h2>

            <p>
                The Virtual Infrastructure Simulator is a small system that keeps running: virtual users send commands,
                virtual servers work through them, and the servers are scaled to keep up.
            </p>
            <p>
                It does not model real infrastructure. It demonstrates LiveSystem, a lightweight framework for
                applications whose state and behavior remain alive over time.
            </p>
            <p>
                This page only displays what happens on the server, and its controls send commands. Everyone who has the
                page open sees the same system.
            </p>

            <ul v-if="config.links.length" class="about__links">
                <li v-for="link in config.links" :key="link.url">
                    <a :href="link.url" data-test="about-link">{{ link.label }}</a>
                </li>
            </ul>

            <form method="dialog" class="about__actions">
                <button data-test="about-close">Close</button>
            </form>
        </div>
    </dialog>
</template>

<style scoped>
.open {
    color: var(--accent);
    font-size: 0.9rem;
}

.about {
    max-width: 32rem;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: 10px;
    color: var(--text);
    background: var(--surface);
}

.about::backdrop {
    background: rgb(0 0 0 / 45%);
}

.about__content {
    padding: 1.25rem;
}

.about h2 {
    margin: 0 0 0.75rem;
    font-size: 1.1rem;
}

.about p {
    margin: 0 0 0.75rem;
    line-height: 1.45;
}

.about__links {
    margin: 0;
    padding-left: 1.2rem;
    line-height: 1.7;
}

.about a {
    color: var(--accent);
}

.about__actions {
    display: flex;
    justify-content: flex-end;
    margin-top: 1rem;
}
</style>
