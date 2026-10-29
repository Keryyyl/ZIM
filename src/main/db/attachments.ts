import type Database from 'better-sqlite3'
import type { Attachment } from '@shared/types'
import type { AttachmentInfo } from '../mail/attachments'

/** Załącznik razem z miejscem wiadomości na serwerze (potrzebnym do pobrania). */
export interface AttachmentLocation {
  id: number
  messageId: number
  accountId: number
  part: string
  filename: string
  mime: string
  size: number
  mailbox: string | null
  serverUid: number | null
}

/** Zapisuje metadane załączników wiadomości i oznacza ją jako sprawdzoną. */
export function saveAttachments(db: Database.Database, messageId: number, infos: AttachmentInfo[]): void {
  const insert = db.prepare(
    `INSERT OR IGNORE INTO attachments (message_id, part, filename, mime, size, content_id, inline)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
  db.transaction(() => {
    for (const a of infos) insert.run(messageId, a.part, a.filename, a.mime, a.size, a.contentId, a.inline ? 1 : 0)
    db.prepare('UPDATE messages SET attachments_checked = 1 WHERE id = ?').run(messageId)
  })()
}

export function listAttachments(db: Database.Database, messageId: number): Attachment[] {
  const rows = db
    .prepare('SELECT id, filename, mime, size, inline FROM attachments WHERE message_id = ? ORDER BY id')
    .all(messageId) as (Omit<Attachment, 'inline'> & { inline: number })[]
  return rows.map((r) => ({ ...r, inline: r.inline === 1 }))
}

export function getAttachment(db: Database.Database, id: number): AttachmentLocation | undefined {
  return db
    .prepare(
      `SELECT a.id, a.message_id AS messageId, m.account_id AS accountId, a.part, a.filename, a.mime, a.size,
              m.mailbox, m.server_uid AS serverUid
       FROM attachments a JOIN messages m ON m.id = a.message_id
       WHERE a.id = ?`
    )
    .get(id) as AttachmentLocation | undefined
}

/** Wiadomości sprzed obsługi załączników: metadane dociągamy partiami przy synchronizacji. */
export function uncheckedMessages(
  db: Database.Database,
  accountId: number,
  mailbox: string,
  limit: number
): { id: number; serverUid: number }[] {
  return db
    .prepare(
      `SELECT id, server_uid AS serverUid FROM messages
       WHERE account_id = ? AND mailbox = ? AND server_uid IS NOT NULL AND attachments_checked = 0
       LIMIT ?`
    )
    .all(accountId, mailbox, limit) as { id: number; serverUid: number }[]
}
