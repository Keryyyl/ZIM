import type { Priority } from '@shared/types'

export interface Classification {
  tags: string[]
  priority: Priority
}

// TODO (krok 5): klasyfikator dla maili, których reguły nie sklasyfikowały.
//  - domyślnie lokalny model przez Ollama (http://localhost:11434/api/chat)
//  - wymuś odpowiedź w JSON (format: schema), ogranicz treść do ~2000 znaków
//  - opcjonalny provider: API Claude Haiku (treść maila idzie do chmury!)
export async function classify(_input: {
  from: string
  subject: string
  body: string
}): Promise<Classification> {
  throw new Error('Nie zaimplementowano')
}
