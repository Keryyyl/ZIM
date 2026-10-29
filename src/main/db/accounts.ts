import type Database from 'better-sqlite3'
import type { Account } from '@shared/types'
import { guessSmtp } from '@shared/smtp'

/** SMTP opcjonalnie: domyślnie zgadujemy z serwera IMAP */
export type NewAccount = Omit<Account, 'id' | 'smtpHost' | 'smtpPort'> & Partial<Pick<Account, 'smtpHost' | 'smtpPort'>>

export function listAccounts(db: Database.Database): Account[] {
  return db
    .prepare(
      `SELECT id, email, alias, imap_host AS imapHost, imap_port AS imapPort,
              smtp_host AS smtpHost, smtp_port AS smtpPort, username
       FROM accounts ORDER BY id`
    )
    .all() as Account[]
}

export const MAX_ALIAS = 40

function normalizeAlias(alias: string | null | undefined): string | null {
  const value = alias?.trim() || null
  if (value && value.length > MAX_ALIAS) throw new Error(`Alias może mieć najwyżej ${MAX_ALIAS} znaków`)
  return value
}

function isPort(port: unknown): port is number {
  return Number.isInteger(port) && (port as number) >= 1 && (port as number) <= 65535
}

export function getAccount(db: Database.Database, id: number): Account | undefined {
  return listAccounts(db).find((a) => a.id === id)
}

export function addAccount(db: Database.Database, input: NewAccount): Account {
  const email = input.email.trim().toLowerCase()
  const imapHost = input.imapHost.trim()
  const username = input.username.trim() || email
  const alias = normalizeAlias(input.alias)
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Nieprawidłowy adres e-mail')
  if (!imapHost) throw new Error('Podaj serwer IMAP')
  if (!isPort(input.imapPort)) throw new Error('Nieprawidłowy port IMAP')
  const guess = guessSmtp(imapHost)
  const smtpHost = input.smtpHost?.trim() || guess.host
  const smtpPort = input.smtpPort ?? guess.port
  if (!isPort(smtpPort)) throw new Error('Nieprawidłowy port SMTP')

  try {
    const { lastInsertRowid } = db
      .prepare(
        `INSERT INTO accounts (email, alias, imap_host, imap_port, smtp_host, smtp_port, username)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(email, alias, imapHost, input.imapPort, smtpHost, smtpPort, username)
    return { id: Number(lastInsertRowid), email, alias, imapHost, imapPort: input.imapPort, smtpHost, smtpPort, username }
  } catch (e) {
    if (String(e).includes('UNIQUE')) throw new Error('To konto jest już dodane')
    throw e
  }
}

/** Pusty alias = powrót do wyświetlania adresu e-mail. */
export function setAccountAlias(db: Database.Database, id: number, alias: string | null): string | null {
  const value = normalizeAlias(alias)
  const { changes } = db.prepare('UPDATE accounts SET alias = ? WHERE id = ?').run(value, id)
  if (changes === 0) throw new Error('Nie ma takiego konta')
  return value
}

export function removeAccount(db: Database.Database, id: number): void {
  db.prepare('DELETE FROM accounts WHERE id = ?').run(id)
}
