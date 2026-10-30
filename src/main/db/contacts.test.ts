import { describe, expect, it } from 'vitest'
import { openDb } from './index'
import { contactMail, deleteContact, listContacts, saveContact } from './contacts'

describe('kontakty', () => {
  it('dodaje, aktualizuje, sortuje i usuwa', () => {
    const db = openDb(':memory:')
    const b = saveContact(db, { name: 'Basia', email: 'B@x.pl', services: [{ service: 'GitHub', username: 'basia' }, { service: '', username: '' }] })
    const a = saveContact(db, { name: 'Adam', email: 'a@x.pl', city: 'Łódź' })
    expect(b.services).toEqual([{ service: 'GitHub', username: 'basia' }])
    expect(listContacts(db).map((c) => c.name)).toEqual(['Adam', 'Basia'])

    saveContact(db, { ...a, name: 'Adam Nowak' })
    expect(listContacts(db)[0]).toMatchObject({ id: a.id, name: 'Adam Nowak', city: 'Łódź' })

    deleteContact(db, b.id as number)
    expect(listContacts(db)).toHaveLength(1)
  })

  it('odrzuca błędne dane i zmianę nieistniejącego kontaktu', () => {
    const db = openDb(':memory:')
    expect(() => saveContact(db, { name: '', email: 'a@x.pl' })).toThrow()
    expect(() => saveContact(db, { id: 99, name: 'X', email: 'x@x.pl' })).toThrow('już nie istnieje')
  })

  it('pokazuje 3 ostatnie wiadomości w obie strony', () => {
    const db = openDb(':memory:')
    db.prepare("INSERT INTO accounts (id, email, imap_host, username) VALUES (1, 'ja@x.pl', 'imap.x.pl', 'ja')").run()
    const insert = db.prepare(
      'INSERT INTO messages (account_id, uid, from_addr, to_addr, subject, date) VALUES (1, ?, ?, ?, ?, ?)'
    )
    insert.run(1, 'Anna <Anna@Firma.pl>', 'ja@x.pl', 'najstarsza', 1)
    insert.run(2, 'ja@x.pl', 'anna@firma.pl', 'moja', 2)
    insert.run(3, 'anna@firma.pl', 'ja@x.pl', 'trzecia', 3)
    insert.run(4, 'anna@firma.pl', 'ja@x.pl', 'najnowsza', 4)
    insert.run(5, 'ktos@inny.pl', 'ja@x.pl', 'cudza', 5)
    const anna = saveContact(db, { name: 'Anna', email: 'anna@firma.pl' })
    expect(contactMail(db, anna.id as number).map((m) => [m.subject, m.direction])).toEqual([
      ['najnowsza', 'received'],
      ['trzecia', 'received'],
      ['moja', 'sent']
    ])
  })
})
