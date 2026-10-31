import type Database from 'better-sqlite3'
import { KEEP_TAG } from './tags'

/** Tagujemy tylko świeże wiadomości; starsze użytkownik może dotagować ręcznie. */
export const RECENT_DAYS = 30
export const MAX_ATTEMPTS = 3
const DAY = 86_400_000

export function recentSince(now: number): number {
  return now - RECENT_DAYS * DAY
}

/** Wiadomość w postaci, jaką dostaje model. */
export interface ClassifyInput {
  id: number
  from: string
  subject: string
  body: string
  /** Nazwy załączników (bez obrazków osadzonych w treści) */
  attachments: string[]
}

// spam i kosz pomijamy: nie ma sensu zużywać na nie modelu
const ELIGIBLE = "folder IN ('inbox', 'archive')"

function toInput(db: Database.Database, row: { id: number; from: string; subject: string; body: string }): ClassifyInput {
  const files = db
    .prepare('SELECT filename FROM attachments WHERE message_id = ? AND inline = 0 ORDER BY id')
    .all(row.id) as { filename: string }[]
  return { ...row, attachments: files.map((f) => f.filename) }
}

const COLUMNS = 'id, from_addr AS "from", subject, body_text AS body'

/** Najnowsza jeszcze niesklasyfikowana wiadomość. */
export function nextToClassify(db: Database.Database, since: number): ClassifyInput | null {
  const row = db
    .prepare(
      `SELECT ${COLUMNS} FROM messages
       WHERE classified_at IS NULL AND classify_attempts < ? AND date >= ? AND ${ELIGIBLE}
       ORDER BY date DESC LIMIT 1`
    )
    .get(MAX_ATTEMPTS, since) as { id: number; from: string; subject: string; body: string } | undefined
  return row ? toInput(db, row) : null
}

/** Automatyczne nadawcy (noreply@, no-reply@, donotreply@): ich maile są zwykle tego samego rodzaju. */
export function isNoReply(email: string | null): boolean {
  const local = (email ?? '').split('@')[0].toLowerCase()
  return /^(no[-_.]?reply|do[-_.]?not[-_.]?reply)(\+.*)?$/.test(local)
}

/**
 * Tagi wcześniejszej, już sprawdzonej wiadomości od tego samego nadawcy automatycznego: noreply albo wiadomość
 * z nagłówkiem List-Unsubscribe (null = nie ma wzorca, trzeba zapytać model). Bierze najnowszą z okna `since`, więc ręczne poprawki użytkownika też się przenoszą,
 * a reprocess (który czyści tylko to okno) nie kopiuje przestarzałych wyników.
 */
export function senderTags(db: Database.Database, messageId: number, since: number): number[] | null {
  const me = db.prepare('SELECT from_email, bulk FROM messages WHERE id = ?').get(messageId) as
    | { from_email: string | null; bulk: number }
    | undefined
  if (!me?.from_email || !(me.bulk === 1 || isNoReply(me.from_email))) return null
  const known = db
    .prepare(
      `SELECT id FROM messages
       WHERE from_email = ? AND id != ? AND classified_at IS NOT NULL AND date >= ?
       ORDER BY classified_at DESC LIMIT 1`
    )
    .get(me.from_email, messageId, since) as { id: number } | undefined
  if (!known) return null
  const rows = db.prepare('SELECT tag_id FROM message_tags WHERE message_id = ?').all(known.id) as { tag_id: number }[]
  return rows.map((r) => r.tag_id)
}

export function loadForClassification(db: Database.Database, id: number): ClassifyInput | null {
  const row = db.prepare(`SELECT ${COLUMNS} FROM messages WHERE id = ? AND folder != 'deleted'`).get(id) as
    | { id: number; from: string; subject: string; body: string }
    | undefined
  return row ? toInput(db, row) : null
}

export function countPending(db: Database.Database, since: number): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n FROM messages
       WHERE classified_at IS NULL AND classify_attempts < ? AND date >= ? AND ${ELIGIBLE}`
    )
    .get(MAX_ATTEMPTS, since) as { n: number }
  return row.n
}

/**
 * Zapisuje wynik modelu: poprzednie tagi od AI tej wiadomości są zastępowane,
 * a tagi dodane ręcznie zostają (INSERT OR IGNORE nie zmienia ich źródła).
 * Wiadomość z tagiem „Zachować” trafia z Odebranych do Archiwum; zwraca true, gdy została przeniesiona.
 */
export function saveClassification(db: Database.Database, messageId: number, tagIds: number[], now: number): boolean {
  return db.transaction(() => {
    db.prepare("DELETE FROM message_tags WHERE message_id = ? AND source = 'llm'").run(messageId)
    const insert = db.prepare("INSERT OR IGNORE INTO message_tags (message_id, tag_id, source) VALUES (?, ?, 'llm')")
    for (const tagId of tagIds) insert.run(messageId, tagId)
    db.prepare('UPDATE messages SET classified_at = ?, classify_attempts = 0 WHERE id = ?').run(now, messageId)
    return (
      db
        .prepare(
          `UPDATE messages SET folder = 'archive'
           WHERE id = ? AND folder = 'inbox'
             AND EXISTS (SELECT 1 FROM message_tags mt JOIN tags t ON t.id = mt.tag_id
                         WHERE mt.message_id = messages.id AND lower(t.name) = lower(?))`
        )
        .run(messageId, KEEP_TAG).changes > 0
    )
  })()
}

export function recordFailure(db: Database.Database, messageId: number): void {
  db.prepare('UPDATE messages SET classify_attempts = classify_attempts + 1 WHERE id = ?').run(messageId)
}

/** Kolejka od nowa dla ostatnich wiadomości (np. po dodaniu tagów albo zmianie modelu). */
export function resetRecent(db: Database.Database, since: number): void {
  db.prepare(
    `UPDATE messages SET classified_at = NULL, classify_attempts = 0 WHERE date >= ? AND ${ELIGIBLE}`
  ).run(since)
}
