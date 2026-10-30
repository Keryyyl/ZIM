import type Database from 'better-sqlite3'
import { Contact, type ContactInit, type ContactMail, type ContactService } from '@shared/contact'

interface Row {
  id: number
  photo: string | null
  name: string
  email: string
  city: string
  description: string
  services: string
}

function parseServices(json: string): ContactService[] {
  try {
    const value: unknown = JSON.parse(json)
    return Array.isArray(value) ? value.filter((s) => typeof s?.service === 'string' && typeof s?.username === 'string') : []
  } catch {
    return []
  }
}

function fromRow(r: Row): ContactInit {
  return new Contact({ ...r, services: parseServices(r.services) }).toJSON()
}

export function listContacts(db: Database.Database): ContactInit[] {
  const rows = db.prepare('SELECT id, photo, name, email, city, description, services FROM contacts ORDER BY lower(name)').all() as Row[]
  return rows.map(fromRow)
}

/** Dodaje (bez id) albo aktualizuje kontakt; dane z renderera przechodzą walidację klasy Contact. */
export function saveContact(db: Database.Database, input: unknown): ContactInit {
  const raw = (input ?? {}) as Partial<ContactInit>
  const services = Array.isArray(raw.services)
    ? raw.services.filter((s) => s && String(s.service ?? '').trim() && String(s.username ?? '').trim())
    : []
  const contact = new Contact({
    id: Number.isInteger(raw.id) ? (raw.id as number) : null,
    photo: typeof raw.photo === 'string' ? raw.photo : null,
    name: String(raw.name ?? ''),
    email: String(raw.email ?? ''),
    city: String(raw.city ?? ''),
    description: String(raw.description ?? ''),
    services: services.map((s) => ({ service: String(s.service), username: String(s.username) }))
  })
  const values = [contact.photo, contact.name, contact.email, contact.city, contact.description, JSON.stringify(contact.services)]
  if (contact.id === null) {
    contact.id = Number(
      db.prepare('INSERT INTO contacts (photo, name, email, city, description, services) VALUES (?, ?, ?, ?, ?, ?)').run(...values)
        .lastInsertRowid
    )
  } else {
    const result = db
      .prepare('UPDATE contacts SET photo = ?, name = ?, email = ?, city = ?, description = ?, services = ? WHERE id = ?')
      .run(...values, contact.id)
    if (result.changes === 0) throw new Error('Kontakt już nie istnieje')
  }
  return contact.toJSON()
}

export function deleteContact(db: Database.Database, id: number): void {
  db.prepare('DELETE FROM contacts WHERE id = ?').run(id)
}

/** Ostatnie wiadomości wymieniane z kontaktem: od niego albo do niego, ze wszystkich kont. */
export function contactMail(db: Database.Database, contactId: number, limit = 3): ContactMail[] {
  const row = db.prepare('SELECT email FROM contacts WHERE id = ?').get(contactId) as { email: string } | undefined
  if (!row) return []
  // instr zamiast LIKE: znaki % i _ w adresie nie mogą działać jak wzorzec
  const rows = db
    .prepare(
      `SELECT id, subject, date, instr(lower(from_addr), @email) > 0 AS received
       FROM messages
       WHERE folder != 'deleted' AND (instr(lower(from_addr), @email) > 0 OR instr(lower(to_addr), @email) > 0)
       ORDER BY date DESC LIMIT @limit`
    )
    .all({ email: row.email, limit }) as { id: number; subject: string; date: number; received: number }[]
  return rows.map((r) => ({ id: r.id, subject: r.subject, date: r.date, direction: r.received === 1 ? 'received' : 'sent' }))
}
