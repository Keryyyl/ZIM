import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { openDb } from './index'
import { createTag, deleteTag, listTags, setMessageTag, tagsByMessage, updateTag } from './tags'

function setup(): Database.Database {
  const db = openDb(':memory:')
  db.prepare("INSERT INTO accounts (id, email, imap_host, username) VALUES (1, 'a@x.pl', 'imap.x.pl', 'a')").run()
  db.prepare(
    "INSERT INTO messages (id, account_id, uid, from_addr, to_addr, subject, date) VALUES (1, 1, 1, 'b@x.pl', 'a@x.pl', 's', 1)"
  ).run()
  return db
}

describe('tagi', () => {
  it('tworzy tag i nie pozwala na duplikat bez względu na wielkość liter', () => {
    const db = setup()
    createTag(db, ' Praca ', '#3B82F6')
    expect(listTags(db)).toEqual([{ id: 1, name: 'Praca', color: '#3b82f6' }])
    expect(() => createTag(db, 'praca', null)).toThrow(/już istnieje/)
    expect(() => createTag(db, '   ', null)).toThrow()
  })

  it('odrzuca niepoprawny kolor zamiast go zapisać', () => {
    const db = setup()
    expect(createTag(db, 'A', 'red; background:url(x)').color).toBeNull()
  })

  it('przypisuje i zdejmuje tag, a usunięcie tagu czyści przypisania', () => {
    const db = setup()
    const tag = createTag(db, 'Praca', null)
    setMessageTag(db, [1], tag.id, true)
    setMessageTag(db, [1], tag.id, true)
    expect(tagsByMessage(db, [1]).get(1)).toEqual([tag])
    setMessageTag(db, [1], tag.id, false)
    expect(tagsByMessage(db, [1]).get(1)).toBeUndefined()
    setMessageTag(db, [1], tag.id, true)
    deleteTag(db, tag.id)
    expect(tagsByMessage(db, [1]).size).toBe(0)
  })

  it('nie tworzy tagu przy przypisywaniu nieistniejącego', () => {
    const db = setup()
    expect(() => setMessageTag(db, [1], 99, true)).toThrow(/nie istnieje/)
  })

  it('zmienia nazwę i kolor', () => {
    const db = setup()
    const tag = createTag(db, 'Praca', null)
    expect(updateTag(db, tag.id, 'Firma', '#ef4444')).toEqual({ id: tag.id, name: 'Firma', color: '#ef4444' })
  })
})
