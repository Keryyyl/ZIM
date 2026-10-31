import type Database from 'better-sqlite3'
import type { AiConfig } from '@shared/types'
import { CLOUD_PROVIDERS, DEFAULT_MODELS, isCloud, isProvider, type AiProvider, type CloudProvider } from '@shared/ai'

export function getSetting(db: Database.Database, key: string): string | null {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined
  return row?.value ?? null
}

export function setSetting(db: Database.Database, key: string, value: string): void {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').run(
    key,
    value
  )
}

/** Model zapamiętany osobno dla każdego dostawcy; stary klucz "ai.model" dotyczył Ollamy. */
export function modelFor(db: Database.Database, provider: AiProvider): string {
  const legacy = provider === 'ollama' ? getSetting(db, 'ai.model') : null
  return getSetting(db, `ai.model.${provider}`) ?? legacy ?? DEFAULT_MODELS[provider]
}

export function getAiConfig(db: Database.Database): AiConfig {
  const stored = getSetting(db, 'ai.provider')
  const provider: AiProvider = isProvider(stored) ? stored : 'ollama'
  // wyłączone dopiero po jawnym wyborze „Brak”; domyślnie asystent działa lokalnie
  return { enabled: getSetting(db, 'ai.enabled') !== '0', provider, model: modelFor(db, provider) }
}

export function getConsent(db: Database.Database, provider: CloudProvider): boolean {
  return getSetting(db, `ai.consent.${provider}`) === '1'
}

export function consentByProvider(db: Database.Database): Record<CloudProvider, boolean> {
  return Object.fromEntries(CLOUD_PROVIDERS.map((p) => [p, getConsent(db, p)])) as Record<CloudProvider, boolean>
}

export function modelsByProvider(db: Database.Database): Record<AiProvider, string> {
  return Object.fromEntries((['ollama', ...CLOUD_PROVIDERS] as AiProvider[]).map((p) => [p, modelFor(db, p)])) as Record<
    AiProvider,
    string
  >
}

/**
 * Zapis ustawień asystenta. Dostawca w chmurze wymaga zgody na wysyłanie treści maili poza komputer:
 * `consent: true` przychodzi z interfejsu dopiero po jej zaznaczeniu i jest zapamiętywana dla dostawcy.
 */
export function setAiConfig(db: Database.Database, raw: unknown): AiConfig {
  const cfg = (raw ?? {}) as { enabled?: unknown; provider?: unknown; model?: unknown; consent?: unknown }
  if (typeof cfg.enabled !== 'boolean') throw new Error('Nieprawidłowe ustawienia asystenta')
  if (!isProvider(cfg.provider)) throw new Error('Nieznany dostawca modelu')
  if (typeof cfg.model !== 'string' || !/^[\w.\-:/]{1,100}$/.test(cfg.model)) throw new Error('Nieprawidłowa nazwa modelu')
  const { enabled, provider, model } = cfg as { enabled: boolean; provider: AiProvider; model: string }

  if (enabled && isCloud(provider) && !getConsent(db, provider)) {
    if (cfg.consent !== true) throw new Error('Najpierw potwierdź zgodę na wysyłanie treści maili do dostawcy')
    setSetting(db, `ai.consent.${provider}`, '1')
  }
  setSetting(db, 'ai.enabled', enabled ? '1' : '0')
  setSetting(db, 'ai.provider', provider)
  setSetting(db, `ai.model.${provider}`, model)
  return getAiConfig(db)
}
