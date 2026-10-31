/** Mały klient lokalnego serwera Ollama; używany do tagowania i skrótów maili. */
import { AiUnavailable } from './errors'

export const OLLAMA_URL = 'http://127.0.0.1:11434'
const REQUEST_TIMEOUT_MS = 120_000

export interface ChatRequest {
  model: string
  system: string
  user: string
  /** JSON Schema odpowiedzi; Ollama wymusza go przy generowaniu */
  schema: object
  baseUrl?: string
}

/** Zwraca treść odpowiedzi (JSON jako tekst). */
export async function chat({ model, system, user, schema, baseUrl = OLLAMA_URL }: ChatRequest): Promise<string> {
  let res: Response
  try {
    res = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      body: JSON.stringify({
        model,
        stream: false,
        think: false, // modele z trybem "myślenia" odpowiadałyby wielokrotnie wolniej
        keep_alive: '30m', // model zostaje w pamięci między mailami
        options: { temperature: 0 },
        format: schema,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user }
        ]
      })
    })
  } catch (e) {
    if ((e as Error).name === 'TimeoutError') throw new Error('Model nie odpowiedział w ciągu 2 minut')
    throw new AiUnavailable('down', 'Nie można połączyć się z Ollamą. Uruchom ją (ollama serve).')
  }
  if (!res.ok) {
    if (res.status === 404) {
      throw new AiUnavailable('no-model', `Brak modelu ${model}. Pobierz go poleceniem: ollama pull ${model}`)
    }
    throw new Error(`Ollama zwróciła błąd ${res.status}: ${(await res.text()).slice(0, 200)}`)
  }
  const data = (await res.json()) as { message?: { content?: string } }
  return data.message?.content ?? ''
}

/** Zainstalowane modele; null = Ollama nie odpowiada. */
export async function listModels(baseUrl = OLLAMA_URL): Promise<string[] | null> {
  try {
    const res = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(2000) })
    if (!res.ok) return null
    const data = (await res.json()) as { models?: { name: string }[] }
    return (data.models ?? []).map((m) => m.name)
  } catch {
    return null
  }
}
