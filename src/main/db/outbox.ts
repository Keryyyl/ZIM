import type Database from 'better-sqlite3'
import type { ScheduledMail } from '@shared/types'
import type { OutgoingMail } from '../mail/send'

const SNIPPET_CHARS = 120

export function scheduleMail(db: Database.Database, accountId: number, mail: OutgoingMail, sendAt: number): number {
  return db.transaction(() => {
    const { lastInsertRowid } = db
      .prepare(
        `INSERT INTO outbox (account_id, to_addrs, subject, body_text, send_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(accountId, JSON.stringify(mail.to), mail.subject, mail.text, sendAt, Date.now())
    const id = Number(lastInsertRowid)
    const attach = db.prepare('INSERT INTO outbox_attachments (outbox_id, filename, data) VALUES (?, ?, ?)')
    for (const a of mail.attachments) attach.run(id, a.filename, a.content)
    return id
  })()
}

export function listScheduled(db: Database.Database, accountId: number | null): ScheduledMail[] {
  const rows = db
    .prepare(
      `SELECT o.id, o.account_id AS accountId, o.to_addrs AS toJson, o.subject, o.body_text AS body,
              o.send_at AS sendAt, o.status, o.error,
              (SELECT COUNT(*) FROM outbox_attachments a WHERE a.outbox_id = o.id) AS attachments
       FROM outbox o
       WHERE @accountId IS NULL OR o.account_id = @accountId
       ORDER BY o.send_at`
    )
    .all({ accountId }) as (Omit<ScheduledMail, 'to' | 'snippet'> & { toJson: string; body: string })[]
  return rows.map(({ toJson, body, ...r }) => ({
    ...r,
    to: JSON.parse(toJson) as string[],
    snippet: body.replace(/\s+/g, ' ').trim().slice(0, SNIPPET_CHARS)
  }))
}

/** Wysyłanej właśnie wiadomości nie da się już anulować. */
export function cancelScheduled(db: Database.Database, id: number): void {
  const { changes } = db.prepare("DELETE FROM outbox WHERE id = ? AND status != 'sending'").run(id)
  if (changes === 0) throw new Error('Tej wiadomości nie można już anulować')
}

export function retryScheduled(db: Database.Database, id: number): void {
  db.prepare("UPDATE outbox SET status = 'scheduled', error = NULL, send_at = ? WHERE id = ? AND status = 'error'").run(
    Date.now(),
    id
  )
}

/** Zaplanowane na teraz lub wcześniej (np. aplikacja była wyłączona); od razu oznaczone jako wysyłane. */
export function claimDue(db: Database.Database, now: number): { id: number; accountId: number; mail: OutgoingMail }[] {
  return db.transaction(() => {
    const due = db
      .prepare(
        `SELECT id, account_id AS accountId, to_addrs AS toJson, subject, body_text AS text
         FROM outbox WHERE status = 'scheduled' AND send_at <= ? ORDER BY send_at`
      )
      .all(now) as { id: number; accountId: number; toJson: string; subject: string; text: string }[]
    const files = db.prepare('SELECT filename, data AS content FROM outbox_attachments WHERE outbox_id = ?')
    const claim = db.prepare("UPDATE outbox SET status = 'sending' WHERE id = ?")
    return due.map((d) => {
      claim.run(d.id)
      return {
        id: d.id,
        accountId: d.accountId,
        mail: {
          to: JSON.parse(d.toJson) as string[],
          subject: d.subject,
          text: d.text,
          attachments: files.all(d.id) as { filename: string; content: Buffer }[]
        }
      }
    })
  })()
}

export function markSent(db: Database.Database, id: number): void {
  db.prepare('DELETE FROM outbox WHERE id = ?').run(id)
}

export function markFailed(db: Database.Database, id: number, error: string): void {
  db.prepare("UPDATE outbox SET status = 'error', error = ? WHERE id = ?").run(error, id)
}

/**
 * Po starcie: 'sending' oznacza, że aplikacja zamknęła się w trakcie wysyłki. Nie wiemy,
 * czy serwer zdążył ją przyjąć, więc nie ponawiamy sami (ryzyko podwójnej wysyłki).
 */
export function recoverInterrupted(db: Database.Database): void {
  db.prepare(
    `UPDATE outbox SET status = 'error',
       error = 'Wysyłkę przerwało zamknięcie aplikacji. Sprawdź Wysłane, zanim spróbujesz ponownie.'
     WHERE status = 'sending'`
  ).run()
}
