import { randomUUID } from 'crypto'
import { ImapFlow } from 'imapflow'
import nodemailer from 'nodemailer'
import MailComposer from 'nodemailer/lib/mail-composer'
import type { Account } from '@shared/types'

/** Limit Gmaila i większości serwerów; większe maile i tak zostałyby odrzucone */
export const MAX_ATTACHMENTS_BYTES = 25 * 1024 * 1024

const EMAIL = /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/

export function isEmail(value: string): boolean {
  return EMAIL.test(value.trim())
}

export interface OutgoingMail {
  to: string[]
  subject: string
  text: string
  attachments: { filename: string; content: Buffer }[]
}

/** Sprawdza wiadomość przed wysłaniem/zaplanowaniem; komunikaty trafiają wprost do UI. */
export function validateMail(mail: OutgoingMail): void {
  if (mail.to.length === 0) throw new Error('Dodaj co najmniej jednego adresata')
  const invalid = mail.to.filter((a) => !isEmail(a))
  if (invalid.length > 0) throw new Error(`Nieprawidłowy adres: ${invalid.join(', ')}`)
  const size = mail.attachments.reduce((n, a) => n + a.content.length, 0)
  if (size > MAX_ATTACHMENTS_BYTES) throw new Error('Załączniki mogą mieć razem najwyżej 25 MB')
}

/** Gotowa wiadomość RFC 822: ta sama trafia przez SMTP do adresatów i przez IMAP do "Wysłanych". */
export async function buildMessage(account: Account, mail: OutgoingMail): Promise<Buffer> {
  const node = new MailComposer({
    from: account.email,
    to: mail.to,
    subject: mail.subject,
    text: mail.text,
    attachments: mail.attachments
  }).compile()
  // Message-ID z domeną nadawcy, jak w zwykłych klientach
  node.setHeader('Message-ID', `<${randomUUID()}@${account.email.split('@')[1]}>`)
  return node.build()
}

export async function sendMail(account: Account, password: string, mail: OutgoingMail): Promise<void> {
  validateMail(mail)
  const raw = await buildMessage(account, mail)
  const transport = nodemailer.createTransport({
    host: account.smtpHost,
    port: account.smtpPort,
    // 465 = TLS od razu, 587 = STARTTLS (wymuszony, żeby hasło nie poszło otwartym tekstem)
    secure: account.smtpPort === 465,
    requireTLS: account.smtpPort !== 465,
    auth: { user: account.username, pass: password }
  })
  try {
    await transport.sendMail({ envelope: { from: account.email, to: mail.to }, raw })
  } finally {
    transport.close()
  }

  // kopia w "Wysłanych" to wygoda, a nie warunek wysyłki: błąd tylko logujemy
  await saveToSent(account, password, raw).catch((e: Error) =>
    console.error(`zapis do Wysłanych ${account.email}:`, (e as { responseText?: string }).responseText || e.message)
  )
}

async function saveToSent(account: Account, password: string, raw: Buffer): Promise<void> {
  const client = new ImapFlow({
    host: account.imapHost,
    port: account.imapPort,
    secure: account.imapPort === 993,
    auth: { user: account.username, pass: password },
    logger: false
  })
  try {
    await client.connect()
    // Gmail sam zapisuje w Wysłanych to, co przeszło przez jego SMTP; dopisanie dałoby duplikat
    if (!client.capabilities.has('X-GM-EXT-1')) {
      const sent = (await client.list()).find((m) => m.specialUse === '\\Sent')
      if (sent) await client.append(sent.path, raw, ['\\Seen'])
    }
    await client.logout()
  } catch (e) {
    client.close()
    throw e
  }
}
