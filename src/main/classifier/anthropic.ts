import Anthropic from '@anthropic-ai/sdk'
import { AiUnavailable } from './errors'
import { strictSchema } from './schema'

const REQUEST_TIMEOUT_MS = 60_000
/** Miejsce także na krótkie „myślenie” modeli, które zawsze je włączają */
const MAX_TOKENS = 2048
/** Modele 5.x mają domyślnie średni wysiłek; do tagowania i skrótów wystarczy niski */
const SUPPORTS_EFFORT = /^claude-(haiku|sonnet|opus|fable|mythos)-5/

export interface AnthropicChatRequest {
  apiKey: string
  model: string
  system: string
  user: string
  schema: object
  /** do testów */
  client?: Pick<Anthropic, 'messages'>
}

export function mapAnthropicError(e: unknown, model: string): Error {
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
    return new AiUnavailable('no-key', 'Anthropic odrzucił klucz API. Sprawdź go w Ustawieniach → Asystent AI.')
  }
  if (e instanceof Anthropic.NotFoundError) {
    return new AiUnavailable('no-model', `Model ${model} nie istnieje albo konto nie ma do niego dostępu.`)
  }
  if (e instanceof Anthropic.RateLimitError) {
    return new AiUnavailable('down', 'Anthropic: przekroczono limit zapytań. Spróbuję ponownie przy następnej synchronizacji.')
  }
  if (e instanceof Anthropic.APIConnectionError) {
    return new AiUnavailable('down', 'Nie można połączyć się z Anthropic. Sprawdź internet.')
  }
  if (e instanceof Anthropic.BadRequestError && /credit balance/i.test(e.message)) {
    return new AiUnavailable('no-key', 'Na koncie Anthropic skończyły się środki.')
  }
  return e instanceof Error ? e : new Error(String(e))
}

/** Zwraca treść odpowiedzi (JSON jako tekst), tak jak klient Ollamy. */
export async function anthropicChat({ apiKey, model, system, user, schema, client }: AnthropicChatRequest): Promise<string> {
  const api = client ?? new Anthropic({ apiKey, timeout: REQUEST_TIMEOUT_MS, maxRetries: 1 })
  let response: Anthropic.Message
  try {
    response = await api.messages.create({
      model,
      max_tokens: MAX_TOKENS,
      system,
      messages: [{ role: 'user', content: user }],
      output_config: {
        format: { type: 'json_schema', schema: strictSchema(schema) as Record<string, unknown> },
        ...(SUPPORTS_EFFORT.test(model) ? { effort: 'low' as const } : {})
      }
    })
  } catch (e) {
    throw mapAnthropicError(e, model)
  }
  if (response.stop_reason === 'refusal') throw new Error('Model odmówił odpowiedzi na tę wiadomość')
  if (response.stop_reason === 'max_tokens') throw new Error('Odpowiedź modelu została ucięta')
  // bloki „thinking” pomijamy; interesuje nas tylko tekst
  return response.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('')
}
