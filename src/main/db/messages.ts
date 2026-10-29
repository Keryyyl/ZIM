import type Database from 'better-sqlite3'
import type { Folder, MailboxView, MessageDetail, MessageQuery, MessageRow } from '@shared/types'
import { listAttachments } from './attachments'

const FOLDERS: readonly Folder[] = ['inbox', 'archive', 'spam', 'trash']
const VIEWS: readonly MailboxView[] = [...FOLDERS, 'starred']
const LIMIT = 1000

export function isFolder(value: unknown): value is Folder {
  return FOLDERS.includes(value as Folder)
}

/** Dane z IPC traktujemy jak niezaufane: tylko dodatnie liczby całkowite. */
export function sanitizeIds(ids: unknown): number[] {
  if (!Array.isArray(ids)) throw new Error('Oczekiwano listy wiadomości')
  return [...new Set(ids.filter((id): id is number => Number.isInteger(id) && id > 0))]
}

/** SQLite ma limit parametrów w zapytaniu, więc duże zaznaczenia dzielimy na paczki. */
function inChunks(ids: number[], fn: (chunk: number[], placeholders: string) => void): void {
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500)
    fn(chunk, chunk.map(() => '?').join(', '))
  }
}

export function listMessages(db: Database.Database, query: MessageQuery): MessageRow[] {
  const view: MailboxView = VIEWS.includes(query.view) ? query.view : 'inbox'
  const where =
    view === 'starred' ? "starred = 1 AND folder IN ('inbox', 'archive')" : 'folder = @view'
  const rows = db
    .prepare(
      `SELECT id, account_id AS accountId, from_addr AS "from", subject, date, snippet,
              read, starred, folder, priority,
              EXISTS (SELECT 1 FROM attachments a WHERE a.message_id = messages.id AND a.inline = 0) AS hasAttachments
       FROM messages
       WHERE ${where} AND (@accountId IS NULL OR account_id = @accountId)
       ORDER BY date DESC LIMIT ${LIMIT}`
    )
    .all({ view, accountId: query.accountId ?? null }) as (Omit<MessageRow, 'read' | 'starred' | 'hasAttachments'> & {
    read: number
    starred: number
    hasAttachments: number
  })[]
  return rows.map((r) => ({
    ...r,
    read: r.read === 1,
    starred: r.starred === 1,
    hasAttachments: r.hasAttachments === 1
  }))
}

export function getMessage(db: Database.Database, id: number): MessageDetail | null {
  const row = db
    .prepare(
      `SELECT id, account_id AS accountId, from_addr AS "from", to_addr AS "to", subject, date, snippet,
              body_text AS bodyText, body_html AS bodyHtml, read, starred, folder, priority
       FROM messages WHERE id = ? AND folder != 'deleted'`
    )
    .get(id) as
    | (Omit<MessageDetail, 'read' | 'starred' | 'hasAttachments' | 'attachments'> & { read: number; starred: number })
    | undefined
  if (!row) return null
  const attachments = listAttachments(db, id)
  return {
    ...row,
    read: row.read === 1,
    starred: row.starred === 1,
    attachments,
    hasAttachments: attachments.some((a) => !a.inline)
  }
}

export function setRead(db: Database.Database, ids: number[], read: boolean): void {
  db.transaction(() =>
    inChunks(ids, (chunk, ph) =>
      db.prepare(`UPDATE messages SET read = ? WHERE id IN (${ph})`).run(read ? 1 : 0, ...chunk)
    )
  )()
}

export function setStarred(db: Database.Database, ids: number[], starred: boolean): void {
  db.transaction(() =>
    inChunks(ids, (chunk, ph) =>
      db.prepare(`UPDATE messages SET starred = ? WHERE id IN (${ph})`).run(starred ? 1 : 0, ...chunk)
    )
  )()
}

/** Archiwizacja, kosz i przywracanie do odebranych. Spam ma osobne funkcje, bo blokuje nadawcę. */
export function moveToFolder(db: Database.Database, ids: number[], folder: Folder): void {
  if (!isFolder(folder)) throw new Error('Nieznany folder')
  db.transaction(() =>
    inChunks(ids, (chunk, ph) =>
      db.prepare(`UPDATE messages SET folder = ? WHERE id IN (${ph}) AND folder != 'deleted'`).run(folder, ...chunk)
    )
  )()
}

function sendersOf(db: Database.Database, ids: number[]): string[] {
  const senders = new Set<string>()
  inChunks(ids, (chunk, ph) => {
    const rows = db
      .prepare(`SELECT DISTINCT from_email FROM messages WHERE id IN (${ph}) AND from_email IS NOT NULL`)
      .all(...chunk) as { from_email: string }[]
    rows.forEach((r) => senders.add(r.from_email))
  })
  return [...senders]
}

/**
 * Blokuje nadawców zaznaczonych wiadomości: wszystkie ich wiadomości (ze wszystkich kont)
 * idą do spamu, a nowe trafią tam już przy synchronizacji.
 * Zwraca liczbę zablokowanych adresów.
 */
export function markSpam(db: Database.Database, ids: number[]): number {
  return db.transaction(() => {
    const senders = sendersOf(db, ids)
    const block = db.prepare('INSERT OR IGNORE INTO spam_senders (email, created_at) VALUES (?, ?)')
    const moveAll = db.prepare(
      "UPDATE messages SET folder = 'spam' WHERE from_email = ? AND folder IN ('inbox', 'archive')"
    )
    const now = Date.now()
    for (const email of senders) {
      block.run(email, now)
      moveAll.run(email)
    }
    // wiadomości bez rozpoznanego adresu też przenosimy, choć nadawcy nie da się zablokować
    moveToFolder(db, ids, 'spam')
    return senders.length
  })()
}

/** Odblokowuje nadawców i wraca ich wiadomości ze spamu do odebranych. */
export function markNotSpam(db: Database.Database, ids: number[]): void {
  db.transaction(() => {
    const unblock = db.prepare('DELETE FROM spam_senders WHERE email = ?')
    const restore = db.prepare("UPDATE messages SET folder = 'inbox' WHERE from_email = ? AND folder = 'spam'")
    for (const email of sendersOf(db, ids)) {
      unblock.run(email)
      restore.run(email)
    }
    moveToFolder(db, ids, 'inbox')
  })()
}

/**
 * Tylko z kosza. Wiersz zostaje jako 'deleted' (niewidoczny), dopóki synchronizacja
 * nie usunie wiadomości z serwera; wiadomości spoza serwera znikają od razu.
 */
export function deleteForever(db: Database.Database, ids: number[]): void {
  db.transaction(() =>
    inChunks(ids, (chunk, ph) => {
      db.prepare(`DELETE FROM messages WHERE id IN (${ph}) AND folder = 'trash' AND mailbox IS NULL`).run(...chunk)
      db.prepare(`UPDATE messages SET folder = 'deleted' WHERE id IN (${ph}) AND folder = 'trash'`).run(...chunk)
    })
  )()
}
