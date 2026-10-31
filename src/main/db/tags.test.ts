import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { openDb } from './index'
import { listMessages } from './messages'
import { createTag, deleteTag, ensureSystemTags, listTags, moveTag, setMessageTag, tagsByMessage, updateTag } from './tags'

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
    const tag = createTag(db, ' Praca ', '#3B82F6')
    expect(listTags(db).find((t) => t.id === tag.id)).toEqual({
      id: tag.id,
      name: 'Praca',
      color: '#3b82f6',
      description: '',
      system: null
    })
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
    expect(updateTag(db, tag.id, 'Firma', '#ef4444')).toEqual({
      id: tag.id,
      name: 'Firma',
      color: '#ef4444',
      description: '',
      system: null
    })
  })

  it('zapisuje opis dla AI i zostawia go, gdy aktualizacja go nie podaje', () => {
    const db = setup()
    const tag = createTag(db, 'Rekrutacje', null, '  potwierdzenia   aplikacji ')
    expect(tag.description).toBe('potwierdzenia aplikacji')
    expect(updateTag(db, tag.id, 'Rekrutacje', null).description).toBe('potwierdzenia aplikacji')
    expect(updateTag(db, tag.id, 'Rekrutacje', null, '').description).toBe('')
    expect(() => createTag(db, 'X', null, 'a'.repeat(201))).toThrow(/najwyżej/)
  })
})

describe('kolejność Odebranych', () => {
  it('Pilne, potem Luźne, potem reszta, na końcu Zachować; w grupie od najnowszych', () => {
    const db = openDb(':memory:')
    db.prepare("INSERT INTO accounts (id, email, imap_host, username) VALUES (1, 'a@x.pl', 'imap.x.pl', 'a')").run()
    const add = db.prepare(
      "INSERT INTO messages (id, account_id, uid, from_addr, to_addr, subject, date, folder) VALUES (?, 1, ?, 'b', 'a', 's', ?, 'inbox')"
    )
    for (let id = 1; id <= 7; id++) add.run(id, id, id)
    const sys = (key: string) => listTags(db).find((t) => t.system === key)!.id
    const [pilne, luzne, zachowac] = [sys('urgent'), sys('loose'), sys('keep')]
    // kolejność zależy od klucza, a nie od nazwy: po zmianie nazw nic się nie zmienia
    updateTag(db, pilne, 'Ważne', null)
    updateTag(db, zachowac, 'Na potem', null)
    setMessageTag(db, [1, 5], zachowac, true)
    setMessageTag(db, [2, 6], pilne, true)
    setMessageTag(db, [3, 7], luzne, true)
    expect(listMessages(db, { accountId: null, view: 'inbox' }).map((m) => m.id)).toEqual([6, 2, 7, 3, 4, 5, 1])
  })
})

describe('widok Wszystko', () => {
  it('zawiera Odebrane i Archiwum, bez spamu i kosza', () => {
    const db = openDb(':memory:')
    db.prepare("INSERT INTO accounts (id, email, imap_host, username) VALUES (1, 'a@x.pl', 'imap.x.pl', 'a')").run()
    const add = db.prepare(
      "INSERT INTO messages (id, account_id, uid, from_addr, to_addr, subject, date, folder) VALUES (?, 1, ?, 'b', 'a', 's', ?, ?)"
    )
    ;['inbox', 'archive', 'spam', 'trash'].forEach((f, i) => add.run(i + 1, i + 1, i + 1, f))
    expect(listMessages(db, { accountId: null, view: 'all' }).map((m) => m.id)).toEqual([2, 1])
  })
})

describe('kolejność tagów', () => {
  it('nowe tagi trafiają na koniec, a moveTag przesuwa o jedno miejsce', () => {
    const db = openDb(':memory:')
    db.prepare('DELETE FROM tags').run() // test samej kolejności, bez wbudowanych tagów na początku listy
    const [b, a, c] = ['B', 'A', 'C'].map((n) => createTag(db, n, null).id)
    const names = () => listTags(db).map((t) => t.name)
    expect(names()).toEqual(['B', 'A', 'C'])
    moveTag(db, c, 'up')
    expect(names()).toEqual(['B', 'C', 'A'])
    moveTag(db, b, 'up') // pierwszy zostaje na miejscu
    moveTag(db, a, 'down') // ostatni też
    expect(names()).toEqual(['B', 'C', 'A'])
    moveTag(db, b, 'down')
    expect(names()).toEqual(['C', 'B', 'A'])
  })
})

describe('wbudowane tagi ważności', () => {
  it('istnieją od pierwszego uruchomienia, z kolorem i opisem dla AI', () => {
    const tags = listTags(openDb(':memory:'))
    expect(tags.map((t) => [t.name, t.system])).toEqual([
      ['Pilne', 'urgent'],
      ['Luźne', 'loose'],
      ['Zachować', 'keep']
    ])
    expect(tags.every((t) => t.color && t.description)).toBe(true)
  })

  it('nie da się ich usunąć, ale można zmienić nazwę, kolor i opis', () => {
    const db = openDb(':memory:')
    const urgent = listTags(db).find((t) => t.system === 'urgent')!
    expect(() => deleteTag(db, urgent.id)).toThrow(/wbudowany/)
    expect(listTags(db)).toHaveLength(3)

    const renamed = updateTag(db, urgent.id, 'Ważne', '#f59e0b', 'tylko od szefa')
    expect(renamed).toMatchObject({ id: urgent.id, name: 'Ważne', color: '#f59e0b', description: 'tylko od szefa', system: 'urgent' })
    ensureSystemTags(db) // ponowne uruchomienie nie tworzy duplikatu pod starą nazwą
    expect(listTags(db).map((t) => t.name)).toEqual(['Ważne', 'Luźne', 'Zachować'])
  })

  it('w istniejącej bazie przejmuje tag o tej samej nazwie i dorabia brakujące', () => {
    const db = openDb(':memory:')
    db.exec("UPDATE tags SET system_key = NULL, name = 'pilne', description = 'moje', color = NULL WHERE name = 'Pilne'")
    db.exec("DELETE FROM tags WHERE name = 'Luźne'")
    ensureSystemTags(db)

    const tags = listTags(db)
    expect(tags).toHaveLength(3)
    expect(tags.find((t) => t.system === 'urgent')).toMatchObject({ name: 'pilne', description: 'moje' })
    expect(tags.find((t) => t.system === 'urgent')!.color).toBeTruthy() // brakujący kolor uzupełniony
    expect(tags.find((t) => t.system === 'loose')).toBeTruthy()
  })
})
