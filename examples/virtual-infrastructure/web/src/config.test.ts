import { describe, expect, test } from 'bun:test'
import { loadWebConfig } from './config.ts'

const answering = (response: () => Response | Promise<Response>) => {
    const urls: string[] = []

    return {
        urls,
        fetch: async (url: string) => {
            urls.push(url)

            return response()
        },
    }
}

const about = { label: 'More about this demo', url: 'https://demo.example.com/virtual-infrastructure' }
const source = { label: 'Source code', url: 'https://git.example.com/demo' }

describe('loadWebConfig', () => {
    test('reads the links from the given file, in their order', async () => {
        const { urls, fetch } = answering(() => Response.json({ links: [source, about] }))

        expect(await loadWebConfig('/config.json', fetch)).toEqual({ links: [source, about] })
        expect(urls).toEqual(['/config.json'])
    })

    test('keeps only what it knows', async () => {
        const { fetch } = answering(() => Response.json({ links: [{ ...about, other: 1 }], other: 2 }))

        expect(await loadWebConfig('/config.json', fetch)).toEqual({ links: [about] })
    })

    test('trims a label', async () => {
        const { fetch } = answering(() => Response.json({ links: [{ ...about, label: '  More  ' }] }))

        expect(await loadWebConfig('/config.json', fetch)).toEqual({ links: [{ ...about, label: 'More' }] })
    })

    test.each([
        ['an empty address', { label: 'More', url: '' }],
        ['no address', { label: 'More' }],
        ['an address that is not a string', { label: 'More', url: 7 }],
        ['a relative address', { label: 'More', url: '/about' }],
        ['an address that would run a script', { label: 'More', url: 'javascript:alert(1)' }],
        ['an empty label', { label: '', url: about.url }],
        ['a label of spaces', { label: '  ', url: about.url }],
        ['no label', { url: about.url }],
        ['a label that is not a string', { label: 7, url: about.url }],
        ['nothing', null],
        ['a string', about.url],
    ])('leaves out a link with %s, and keeps the others', async (_name, link) => {
        const { fetch } = answering(() => Response.json({ links: [link, source] }))

        expect(await loadWebConfig('/config.json', fetch)).toEqual({ links: [source] })
    })

    test.each([
        ['no links', {}],
        ['links that are not a list', { links: about }],
        ['a file that is not an object', null],
    ])('is empty with %s', async (_name, body) => {
        const { fetch } = answering(() => Response.json(body))

        expect(await loadWebConfig('/config.json', fetch)).toEqual({ links: [] })
    })

    test('is empty when the file is missing', async () => {
        const { fetch } = answering(() => new Response('Not Found', { status: 404 }))

        expect(await loadWebConfig('/config.json', fetch)).toEqual({ links: [] })
    })

    test('is empty when the answer is not JSON', async () => {
        // What a server gives that answers every unknown path with the page
        const { fetch } = answering(() => new Response('<!doctype html>', { headers: { 'Content-Type': 'text/html' } }))

        expect(await loadWebConfig('/config.json', fetch)).toEqual({ links: [] })
    })

    test('is empty when the request fails', async () => {
        const { fetch } = answering(() => Promise.reject(new TypeError('Failed to fetch')))

        expect(await loadWebConfig('/config.json', fetch)).toEqual({ links: [] })
    })
})
