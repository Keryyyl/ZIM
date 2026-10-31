import Anthropic from '@anthropic-ai/sdk'
import { describe, expect, it, vi } from 'vitest'
import { anthropicChat, mapAnthropicError } from './anthropic'
import { AiUnavailable } from './errors'
import { openaiChat, OPENAI_URL } from './openai'
import { createChat } from './providers'
import { strictSchema } from './schema'
import { schemaFor } from './llm'
import type { Tag } from '@shared/types'

const tags: Tag[] = [
  { id: 1, name: 'Rekrutacje', color: null, description: '' },
  { id: 2, name: 'Pilne', color: null, description: '', system: 'urgent' }
]

describe('strictSchema', () => {
  it('zamyka obiekty i usuwa limity, zostawiając enumy i required', () => {
    const out = strictSchema(schemaFor(tags)) as {
      additionalProperties: boolean
      required: string[]
      properties: { tags: { maxItems?: number; items: { enum: string[] } } }
    }
    expect(out.additionalProperties).toBe(false)
    expect(out.required).toEqual(['priority', 'tags'])
    expect(out.properties.tags.maxItems).toBeUndefined()
    expect(out.properties.tags.items.enum).toEqual(['Rekrutacje'])
  })

  it('nie zmienia schematu wejściowego', () => {
    const input = schemaFor(tags)
    const before = JSON.stringify(input)
    strictSchema(input)
    expect(JSON.stringify(input)).toBe(before)
  })
})

describe('openaiChat', () => {
  const reply = (body: unknown, status = 200): typeof fetch =>
    (async () => new Response(JSON.stringify(body), { status })) as typeof fetch
  const base = { apiKey: 'sk-test-12345', model: 'gpt-4o-mini', system: 's', user: 'u', schema: schemaFor(tags) }

  it('wysyła żądanie ze schematem i kluczem w nagłówku, zwraca treść', async () => {
    const fetchFn = vi.fn(reply({ choices: [{ message: { content: '{"tags":[]}' }, finish_reason: 'stop' }] }))
    expect(await openaiChat({ ...base, fetchFn })).toBe('{"tags":[]}')

    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(OPENAI_URL)
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-test-12345')
    const body = JSON.parse(init.body as string)
    expect(body.response_format.json_schema.strict).toBe(true)
    expect(body.temperature).toBe(0)
    expect(JSON.stringify(body)).not.toContain('maxItems')
  })

  it('nie wysyła temperatury modelom rozumującym', async () => {
    const fetchFn = vi.fn(reply({ choices: [{ message: { content: '{}' } }] }))
    await openaiChat({ ...base, model: 'o4-mini', fetchFn })
    expect(JSON.parse((fetchFn.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)).not.toHaveProperty('temperature')
  })

  it('mapuje błędy na niedostępność dostawcy albo zwykły błąd', async () => {
    const reason = async (status: number, error?: object): Promise<string> => {
      try {
        await openaiChat({ ...base, fetchFn: reply({ error }, status) })
      } catch (e) {
        return e instanceof AiUnavailable ? e.reason : `błąd:${(e as Error).message}`
      }
      return 'ok'
    }
    expect(await reason(401)).toBe('no-key')
    expect(await reason(404)).toBe('no-model')
    expect(await reason(429, { code: 'insufficient_quota' })).toBe('no-key')
    expect(await reason(429, { code: 'rate_limit_exceeded' })).toBe('down')
    expect(await reason(500, { message: 'awaria' })).toMatch(/^błąd:.*awaria/)

    const offline = (async () => {
      throw new TypeError('fetch failed')
    }) as typeof fetch
    await expect(openaiChat({ ...base, fetchFn: offline })).rejects.toMatchObject({ reason: 'down' })
  })

  it('odmowę modelu traktuje jako błąd wiadomości', async () => {
    const fetchFn = reply({ choices: [{ message: { content: null, refusal: 'nie mogę' } }] })
    await expect(openaiChat({ ...base, fetchFn })).rejects.toThrow(/odmówił/)
  })
})

describe('anthropicChat', () => {
  const fakeClient = (message: object) =>
    ({ messages: { create: vi.fn(async () => message) } }) as unknown as Pick<Anthropic, 'messages'> & {
      messages: { create: ReturnType<typeof vi.fn> }
    }
  const base = { apiKey: 'sk-ant-test-12345', model: 'claude-haiku-5-5', system: 's', user: 'u', schema: schemaFor(tags) }

  it('prosi o JSON ze schematem i niskim wysiłkiem, a z odpowiedzi bierze tylko tekst', async () => {
    const client = fakeClient({
      stop_reason: 'end_turn',
      content: [
        { type: 'thinking', thinking: '' },
        { type: 'text', text: '{"tags":["Rekrutacje"]}' }
      ]
    })
    expect(await anthropicChat({ ...base, client })).toBe('{"tags":["Rekrutacje"]}')

    const params = client.messages.create.mock.calls[0][0]
    expect(params.output_config.effort).toBe('low')
    expect(params.output_config.format.type).toBe('json_schema')
    expect(JSON.stringify(params)).not.toContain('maxItems')
    expect(params).not.toHaveProperty('temperature')
    expect(params).not.toHaveProperty('tool_choice') // wymuszony tool zwraca 400 na nowych modelach
  })

  it('nie wysyła wysiłku modelom, które go nie znają', async () => {
    const client = fakeClient({ stop_reason: 'end_turn', content: [{ type: 'text', text: '{}' }] })
    await anthropicChat({ ...base, model: 'claude-3-5-haiku-latest', client })
    expect(client.messages.create.mock.calls[0][0].output_config).not.toHaveProperty('effort')
  })

  it('odmowę i ucięcie odpowiedzi zgłasza jako błąd wiadomości', async () => {
    await expect(anthropicChat({ ...base, client: fakeClient({ stop_reason: 'refusal', content: [] }) })).rejects.toThrow(/odmówił/)
    await expect(anthropicChat({ ...base, client: fakeClient({ stop_reason: 'max_tokens', content: [] }) })).rejects.toThrow(/ucięta/)
  })

  it('mapuje błędy SDK na niedostępność dostawcy', () => {
    const make = (status: number, message = 'x'): Error =>
      Anthropic.APIError.generate(status, { type: 'error', error: { type: 'e', message } }, message, new Headers()) as Error
    const reason = (e: Error): unknown => (mapAnthropicError(e, 'm') as AiUnavailable).reason
    expect(reason(make(401))).toBe('no-key')
    expect(reason(make(404))).toBe('no-model')
    expect(reason(make(429))).toBe('down')
    expect(reason(make(400, 'Your credit balance is too low'))).toBe('no-key')
    expect(mapAnthropicError(make(500), 'm')).not.toBeInstanceOf(AiUnavailable)
  })
})

describe('createChat', () => {
  it('bez klucza w Keychain zgłasza brak klucza, zanim cokolwiek wyśle', async () => {
    const chat = createChat(() => null)
    await expect(
      chat({ config: { enabled: true, provider: 'openai', model: 'gpt-4o-mini' }, system: 's', user: 'u', schema: {} })
    ).rejects.toMatchObject({ reason: 'no-key' })
  })
})
