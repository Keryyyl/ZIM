import { AiUnavailable } from './errors'
import { strictSchema } from './schema'

export const OPENAI_URL = 'https://api.openai.com/v1/chat/completions'
const REQUEST_TIMEOUT_MS = 60_000
/** Modele rozumujące zużywają część limitu na myślenie, więc zostawiamy zapas */
const MAX_COMPLETION_TOKENS = 4096

export interface OpenAiChatRequest {
  apiKey: string
  model: string
  system: string
  user: string
  schema: object
  /** do testów */
  fetchFn?: typeof fetch
}

interface OpenAiReply {
  choices?: { message?: { content?: string | null; refusal?: string | null }; finish_reason?: string }[]
  error?: { message?: string; code?: string | null }
}

export async function openaiChat({ apiKey, model, system, user, schema, fetchFn = fetch }: OpenAiChatRequest): Promise<string> {
  let res: Response
  try {
    res = await fetchFn(OPENAI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      body: JSON.stringify({
        model,
        max_completion_tokens: MAX_COMPLETION_TOKENS,
        // modele rozumujące (o*, gpt-5) nie przyjmują temperatury; rodzina gpt-4 tak
        ...(/^gpt-4/.test(model) ? { temperature: 0 } : {}),
        response_format: { type: 'json_schema', json_schema: { name: 'reply', strict: true, schema: strictSchema(schema) } },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user }
        ]
      })
    })
  } catch {
    throw new AiUnavailable('down', 'Nie można połączyć się z OpenAI. Sprawdź internet.')
  }
  const data = (await res.json().catch(() => ({}))) as OpenAiReply
  if (!res.ok) {
    const detail = data.error?.message ?? `błąd ${res.status}`
    if (res.status === 401 || res.status === 403) {
      throw new AiUnavailable('no-key', 'OpenAI odrzuciło klucz API. Sprawdź go w Ustawieniach → Asystent AI.')
    }
    if (res.status === 404) throw new AiUnavailable('no-model', `Model ${model} nie istnieje albo konto nie ma do niego dostępu.`)
    if (res.status === 429) {
      if (data.error?.code === 'insufficient_quota') throw new AiUnavailable('no-key', 'Na koncie OpenAI skończyły się środki.')
      throw new AiUnavailable('down', 'OpenAI: przekroczono limit zapytań. Spróbuję ponownie przy następnej synchronizacji.')
    }
    throw new Error(`OpenAI zwróciło błąd ${res.status}: ${detail.slice(0, 200)}`)
  }
  const choice = data.choices?.[0]
  if (choice?.message?.refusal) throw new Error('Model odmówił odpowiedzi na tę wiadomość')
  if (choice?.finish_reason === 'length') throw new Error('Odpowiedź modelu została ucięta')
  return choice?.message?.content ?? ''
}
