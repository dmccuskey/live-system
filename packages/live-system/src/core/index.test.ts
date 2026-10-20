import { expect, test } from 'bun:test'

test('the core entry point loads', async () => {
    expect(await import('live-system/core')).toBeDefined()
})

// Core needs Vue's reactivity alone: an app that isn't Vue brings neither Pinia nor Vue's components
test('the core entry point imports neither Pinia nor Vue, only @vue/reactivity', async () => {
    const result = await Bun.build({
        entrypoints: [`${import.meta.dir}/index.ts`],
        packages: 'external',
        metafile: true,
    })

    expect(result.success).toBe(true)

    const imported = Object.values(result.metafile!.inputs).flatMap(input => input.imports.map(i => i.path))

    expect(imported.filter(path => /^(pinia|vue|@vue\/)/.test(path) && path !== '@vue/reactivity')).toEqual([])
})
