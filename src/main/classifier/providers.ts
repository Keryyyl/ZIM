import type { AiConfig } from '@shared/types'
import { isCloud, PROVIDER_LABELS, type CloudProvider } from '@shared/ai'
import { anthropicChat } from './anthropic'
import { AiUnavailable } from './errors'
import { openaiChat } from './openai'
import { chat as ollamaChat } from './ollama'

export interface LlmRequest {
  config: AiConfig
  system: string
  user: string
  /** JSON Schema odpowiedzi; każdy dostawca wymusza go po swojemu */
  schema: object
}

/** Jedno wejście do modelu, niezależnie od dostawcy; zwraca JSON jako tekst. */
export type ChatFn = (req: LlmRequest) => Promise<string>

/** `getKey` czyta klucz API z bezpiecznego magazynu (Keychain); rdzeń nie wie, skąd on pochodzi. */
export function createChat(getKey: (provider: CloudProvider) => string | null): ChatFn {
  return async ({ config, system, user, schema }) => {
    const { provider, model } = config
    if (!isCloud(provider)) return ollamaChat({ model, system, user, schema })

    const apiKey = getKey(provider)
    if (!apiKey) {
      throw new AiUnavailable('no-key', `Brak klucza API: ${PROVIDER_LABELS[provider]}. Dodaj go w Ustawieniach → Asystent AI.`)
    }
    const call = provider === 'anthropic' ? anthropicChat : openaiChat
    return call({ apiKey, model, system, user, schema })
  }
}
