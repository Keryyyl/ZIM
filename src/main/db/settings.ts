import type Database from 'better-sqlite3'
import type { AiConfig } from '@shared/types'

export const DEFAULT_MODEL = 'gemma3:4b'

export function getSetting(db: Database.Database, key: string): string | undefined {
  return (db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined)?.value
}

export function setSetting(db: Database.Database, key: string, value: string): void {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').run(
    key,
    value
  )
}

export function getAiConfig(db: Database.Database): AiConfig {
  return {
    enabled: getSetting(db, 'ai.enabled') !== '0',
    model: getSetting(db, 'ai.model') || DEFAULT_MODEL
  }
}

/** Dane z IPC są niezaufane: nazwa modelu to krótki ciąg bez białych znaków. */
export function setAiConfig(db: Database.Database, config: unknown): AiConfig {
  const { enabled, model } = (config ?? {}) as Partial<AiConfig>
  const name = typeof model === 'string' ? model.trim() : ''
  if (!/^[\w.\-:/]{1,100}$/.test(name)) throw new Error('Niepoprawna nazwa modelu')
  setSetting(db, 'ai.enabled', enabled === true ? '1' : '0')
  setSetting(db, 'ai.model', name)
  return getAiConfig(db)
}
