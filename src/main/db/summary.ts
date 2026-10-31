import type Database from 'better-sqlite3'

export function getSummary(db: Database.Database, messageId: number): string | null {
  const row = db.prepare('SELECT summary FROM messages WHERE id = ?').get(messageId) as
    | { summary: string | null }
    | undefined
  return row?.summary ?? null
}

export function saveSummary(db: Database.Database, messageId: number, summary: string): void {
  db.prepare('UPDATE messages SET summary = ? WHERE id = ?').run(summary, messageId)
}
