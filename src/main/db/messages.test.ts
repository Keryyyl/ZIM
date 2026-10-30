import { describe, expect, it } from 'vitest'
import { openDb } from './index'
import { listMessages, toFtsQuery } from './messages'

describe('toFtsQuery', () => {
  it('zamienia słowa na prefiksy, które muszą wystąpić wszystkie', () => {
    expect(toFtsQuery('faktura  marzec')).toBe('"faktura"* "marzec"*')
  })

  it('usuwa cudzysłowy, żeby fraza nie psuła zapytania FTS', () => {
    expect(toFtsQuery('a"b OR "')).toBe('"ab"* "OR"*')
  })

  it('zwraca null dla pustej frazy', () => {
    expect(toFtsQuery('   ')).toBeNull()
  })
})

describe('listMessages: korespondencja', () => {
  it('pokazuje wiadomości od adresu i do niego we wszystkich folderach poza usuniętymi', () => {
    const db = openDb(':memory:')
    db.prepare("INSERT INTO accounts (id, email, imap_host, username) VALUES (1, 'ja@x.pl', 'imap.x.pl', 'ja')").run()
    const insert = db.prepare(
      'INSERT INTO messages (account_id, uid, from_addr, to_addr, subject, date, folder) VALUES (1, ?, ?, ?, ?, ?, ?)'
    )
    insert.run(1, 'Anna <anna@firma.pl>', 'ja@x.pl', 'a', 1, 'inbox')
    insert.run(2, 'ja@x.pl', 'ANNA@firma.pl', 'b', 2, 'archive')
    insert.run(3, 'anna@firma.pl', 'ja@x.pl', 'c', 3, 'trash')
    insert.run(4, 'anna@firma.pl', 'ja@x.pl', 'd', 4, 'deleted')
    insert.run(5, 'ktos@inny.pl', 'ja@x.pl', 'e', 5, 'inbox')
    const rows = listMessages(db, { accountId: null, view: 'inbox', correspondent: 'Anna@Firma.pl' })
    expect(rows.map((r) => r.subject)).toEqual(['c', 'b', 'a'])
  })
})
