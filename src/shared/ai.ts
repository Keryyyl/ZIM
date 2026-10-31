/** Skąd asystent bierze model: pobrany lokalnie (Ollama) albo zewnętrzny dostawca w chmurze. */
export type CloudProvider = 'anthropic' | 'openai'
export type AiProvider = 'ollama' | CloudProvider

export const CLOUD_PROVIDERS: CloudProvider[] = ['anthropic', 'openai']

export const isCloud = (p: AiProvider): p is CloudProvider => p !== 'ollama'
export const isProvider = (p: unknown): p is AiProvider => p === 'ollama' || p === 'anthropic' || p === 'openai'

export const PROVIDER_LABELS: Record<AiProvider, string> = {
  ollama: 'Pobrany model (Ollama)',
  anthropic: 'Claude (Anthropic)',
  openai: 'ChatGPT (OpenAI)'
}

/** Domyślny model: do tagowania w tle wybieramy najtańszy, bo zapytań są setki */
export const DEFAULT_MODELS: Record<AiProvider, string> = {
  ollama: 'gemma3:4b',
  anthropic: 'claude-haiku-5-5',
  openai: 'gpt-4o-mini'
}

/** Podpowiedzi w ustawieniach; użytkownik może wpisać dowolną nazwę modelu */
export const MODEL_SUGGESTIONS: Record<CloudProvider, string[]> = {
  anthropic: ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5'],
  openai: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini', 'gpt-4.1']
}

export const KEY_HELP: Record<CloudProvider, string> = {
  anthropic: 'https://console.anthropic.com/settings/keys',
  openai: 'https://platform.openai.com/api-keys'
}
