import Database from 'better-sqlite3'
import { describe, expect, it, vi } from 'vitest'
import type { Tag } from '@shared/types'
import { openDb } from '../db'
import { isNoReply, MAX_ATTEMPTS } from '../db/classification'
import { getAiConfig, getConsent, modelsByProvider, setAiConfig, setSetting } from '../db/settings'
import { createTag, listTags, setMessageTag, tagsByMessage, updateTag } from '../db/tags'
import { buildPrompt, cleanBody, parseTagIds, schemaFor } from './llm'
import { AiUnavailable } from './errors'
import { createClassifier } from './queue'

const NOW = Date.UTC(2026, 9, 30)

const tags: Tag[] = [
  { id: 1, name: 'Rekrutacje', color: null, description: 'potwierdzenia aplikacji' },
  { id: 2, name: 'Rachunki', color: null, description: '' }
]

describe('prompt', () => {
  it('opisuje tagi i zawiera dane maila wraz z załącznikami', () => {
    const { system, user } = buildPrompt(tags, {
      id: 1,
      from: 'hr@firma.pl',
      subject: 'Dziękujemy',
      body: 'Twoje zgłoszenie przyjęto',
      attachments: ['CV.pdf']
    })
    expect(system).toContain('- Rekrutacje: potwierdzenia aplikacji')
    expect(system).toContain('- Rachunki')
    expect(system).not.toContain('- Rachunki:')
    expect(user).toContain('Załączniki: CV.pdf')
    expect(user).toContain('Temat: Dziękujemy')
  })

  it('pomija linię załączników, gdy ich nie ma', () => {
    const { user } = buildPrompt(tags, { id: 1, from: 'a', subject: 'b', body: 'c', attachments: [] })
    expect(user).not.toContain('Załączniki')
  })

  it('czyści treść: bez cytatów, z krótkimi linkami, ucięta do limitu', () => {
    expect(cleanBody('Cześć\n> stary cytat\nzobacz https://x.pl/bardzo/dlugi?a=1')).toBe('Cześć\nzobacz [link]')
    expect(cleanBody('a'.repeat(50), 10)).toBe(`${'a'.repeat(10)}…`)
  })

  it('schemat dopuszcza wyłącznie nazwy istniejących tagów', () => {
    const schema = schemaFor(tags) as { properties: { tags: { items: { enum: string[] } } } }
    expect(schema.properties.tags.items.enum).toEqual(['Rekrutacje', 'Rachunki'])
  })
})

describe('parseTagIds', () => {
  it('mapuje nazwy na id bez względu na wielkość liter i usuwa powtórzenia', () => {
    expect(parseTagIds('{"tags":["rekrutacje","Rekrutacje","Rachunki"]}', tags)).toEqual([1])
  })

  it('odrzuca nieznane nazwy', () => {
    expect(parseTagIds('{"tags":["Wymyślony"]}', tags)).toEqual([])
  })

  it('rzuca błąd dla śmieci zamiast zgadywać', () => {
    expect(() => parseTagIds('nie json', tags)).toThrow(/JSON/)
    expect(() => parseTagIds('{"inne":1}', tags)).toThrow(/listy tagów/)
  })
})

function setup(): Database.Database {
  const db = openDb(':memory:')
  db.prepare("INSERT INTO accounts (id, email, imap_host, username) VALUES (1, 'a@x.pl', 'imap.x.pl', 'a')").run()
  return db
}

function addMessage(db: Database.Database, id: number, daysAgo: number, folder = 'inbox', from = 'b@x.pl'): void {
  db.prepare(
    `INSERT INTO messages (id, account_id, uid, from_addr, from_email, to_addr, subject, date, body_text, folder)
     VALUES (?, 1, ?, ?, ?, 'a@x.pl', ?, ?, 'treść', ?)`
  ).run(id, id, from, from, `Temat ${id}`, NOW - daysAgo * 86_400_000, folder)
}

describe('kolejka klasyfikacji', () => {
  const make = (db: Database.Database, classify: ReturnType<typeof vi.fn>, enabled = true) =>
    createClassifier({ db, config: () => ({ enabled, provider: 'ollama', model: 'm' }), classify, now: () => NOW })

  it('taguje świeże wiadomości z odebranych i archiwum, od najnowszej', async () => {
    const db = setup()
    const tag = createTag(db, 'Praca', null)
    addMessage(db, 1, 5)
    addMessage(db, 2, 1)
    addMessage(db, 3, 2, 'spam') // spam pomijamy
    addMessage(db, 4, 90) // za stara
    const order: number[] = []
    const classify = vi.fn(async (_t: Tag[], mail: { id: number }) => {
      order.push(mail.id)
      return [tag.id]
    })
    const classifier = make(db, classify)
    classifier.kick()
    await vi.waitFor(() => expect(classifier.status().state).toBe('idle'))

    expect(order).toEqual([2, 1])
    expect(tagsByMessage(db, [1, 2]).get(2)?.[0].name).toBe('Praca')
    expect(tagsByMessage(db, [3, 4]).size).toBe(0)
    expect(classifier.status().pending).toBe(0)
  })

  it('nie rusza tagów dodanych ręcznie', async () => {
    const db = setup()
    const tag = createTag(db, 'Praca', null)
    addMessage(db, 1, 1)
    setMessageTag(db, [1], tag.id, true)
    const classifier = make(db, vi.fn(async () => [tag.id]))
    classifier.kick()
    await vi.waitFor(() => expect(classifier.status().state).toBe('idle'))
    const source = db.prepare('SELECT source FROM message_tags WHERE message_id = 1').get() as { source: string }
    expect(source.source).toBe('manual')
  })

  it('bez tagów albo po wyłączeniu nic nie robi', async () => {
    const db = setup()
    db.prepare('DELETE FROM tags').run() // wbudowane tagi ważności są zawsze, więc usuwamy je wprost
    addMessage(db, 1, 1)
    const classify = vi.fn(async () => [])
    const noTags = make(db, classify)
    noTags.kick()
    await vi.waitFor(() => expect(noTags.status().state).toBe('no-tags'))

    createTag(db, 'Praca', null)
    const off = make(db, classify, false)
    off.kick()
    await vi.waitFor(() => expect(off.status().state).toBe('disabled'))
    expect(classify).not.toHaveBeenCalled()
  })

  it('gdy Ollama nie działa, przerywa bez zużywania prób i wraca przy następnym uruchomieniu', async () => {
    const db = setup()
    const tag = createTag(db, 'Praca', null)
    addMessage(db, 1, 1)
    let down = true
    const classify = vi.fn(async () => {
      if (down) throw new AiUnavailable('down', 'brak połączenia')
      return [tag.id]
    })
    const classifier = make(db, classify)
    classifier.kick()
    await vi.waitFor(() => expect(classifier.status().state).toBe('unavailable'))
    expect(classifier.status().error).toBe('brak połączenia')
    expect(classifier.status().pending).toBe(1)

    down = false
    classifier.kick()
    await vi.waitFor(() => expect(classifier.status().state).toBe('idle'))
    expect(tagsByMessage(db, [1]).get(1)).toHaveLength(1)
  })

  it('przy odrzuconym kluczu API przerywa ze stanem no-key i nie zużywa prób', async () => {
    const db = setup()
    createTag(db, 'Praca', null)
    addMessage(db, 1, 1)
    const classify = vi.fn(async () => {
      throw new AiUnavailable('no-key', 'Anthropic odrzucił klucz API')
    })
    const classifier = make(db, classify)
    classifier.kick()
    await vi.waitFor(() => expect(classifier.status().state).toBe('no-key'))
    expect(classifier.status().error).toBe('Anthropic odrzucił klucz API')
    expect(classifier.status().pending).toBe(1)
    expect(classify).toHaveBeenCalledTimes(1)
  })

  it('po kilku nieudanych próbach rezygnuje z wiadomości, zamiast mielić ją w kółko', async () => {
    const db = setup()
    createTag(db, 'Praca', null)
    addMessage(db, 1, 1)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const classify = vi.fn(async () => {
      throw new Error('Model zwrócił niepoprawny JSON')
    })
    const classifier = make(db, classify)
    classifier.kick()
    await vi.waitFor(() => expect(classifier.status().state).toBe('idle'))
    expect(classify).toHaveBeenCalledTimes(MAX_ATTEMPTS)
    expect(classifier.status().pending).toBe(0)
  })

  it('reprocess i classifyNow zastępują tagi od AI nowym wynikiem', async () => {
    const db = setup()
    const a = createTag(db, 'A', null)
    const b = createTag(db, 'B', null)
    addMessage(db, 1, 1)
    let answer = a.id
    const classifier = make(db, vi.fn(async () => [answer]))
    classifier.kick()
    await vi.waitFor(() => expect(classifier.status().state).toBe('idle'))
    expect(tagsByMessage(db, [1]).get(1)?.map((t) => t.name)).toEqual(['A'])

    answer = b.id
    await classifier.classifyNow(1)
    expect(tagsByMessage(db, [1]).get(1)?.map((t) => t.name)).toEqual(['B'])

    answer = a.id
    classifier.reprocess()
    await vi.waitFor(() => expect(tagsByMessage(db, [1]).get(1)?.map((t) => t.name)).toEqual(['A']))
  })

  it('nadawcę noreply sprawdza model raz, kolejne maile dostają te same tagi', async () => {
    const db = setup()
    const tag = createTag(db, 'Rekrutacje', null)
    addMessage(db, 1, 3, 'inbox', 'noreply@firma.pl')
    addMessage(db, 2, 2, 'inbox', 'noreply@firma.pl')
    addMessage(db, 3, 1, 'inbox', 'noreply@firma.pl')
    addMessage(db, 4, 1, 'inbox', 'jan@firma.pl') // zwykły nadawca: zawsze model
    addMessage(db, 5, 2, 'inbox', 'jan@firma.pl')
    const classify = vi.fn(async () => [tag.id])
    const classifier = make(db, classify)
    classifier.kick()
    await vi.waitFor(() => expect(classifier.status().state).toBe('idle'))

    expect(classify).toHaveBeenCalledTimes(3) // 1x noreply + 2x jan
    expect(tagsByMessage(db, [1, 2, 3]).size).toBe(3)
    expect(tagsByMessage(db, [1, 2, 3]).get(1)?.[0].name).toBe('Rekrutacje')
  })

  it('nadawcę z nagłówkiem List-Unsubscribe też sprawdza model raz', async () => {
    const db = setup()
    const tag = createTag(db, 'Newslettery', null)
    addMessage(db, 1, 3, 'inbox', 'news@sklep.pl')
    addMessage(db, 2, 2, 'inbox', 'news@sklep.pl')
    addMessage(db, 3, 1, 'inbox', 'jan@firma.pl')
    addMessage(db, 4, 2, 'inbox', 'jan@firma.pl')
    db.prepare('UPDATE messages SET bulk = 1 WHERE id IN (1, 2)').run()
    db.prepare('UPDATE messages SET bulk = 1 WHERE id = 3').run() // najnowsza Jana ma nagłówek, ale starsza go nie ma
    const classify = vi.fn(async () => [tag.id])
    const classifier = make(db, classify)
    classifier.kick()
    await vi.waitFor(() => expect(classifier.status().state).toBe('idle'))
    expect(classify).toHaveBeenCalledTimes(3) // news 1x, Jan 2x (jego starszy mail bez nagłówka zawsze idzie do modelu)
  })

  it('classifyNow zawsze pyta model, nawet dla znanego nadawcy noreply', async () => {
    const db = setup()
    const a = createTag(db, 'A', null)
    const b = createTag(db, 'B', null)
    addMessage(db, 1, 2, 'inbox', 'no-reply@x.pl')
    addMessage(db, 2, 1, 'inbox', 'no-reply@x.pl')
    let answer = a.id
    const classify = vi.fn(async () => [answer])
    const classifier = make(db, classify)
    classifier.kick()
    await vi.waitFor(() => expect(classifier.status().state).toBe('idle'))
    answer = b.id
    await classifier.classifyNow(2)
    expect(tagsByMessage(db, [2]).get(2)?.map((t) => t.name)).toEqual(['B'])
  })

  it('classifyNow zwraca użytkownikowi błąd modelu', async () => {
    const db = setup()
    createTag(db, 'A', null)
    addMessage(db, 1, 1)
    const classifier = make(db, vi.fn(async () => {
      throw new AiUnavailable('no-model', 'Brak modelu m')
    }))
    await expect(classifier.classifyNow(1)).rejects.toThrow('Brak modelu m')
  })
})

describe('isNoReply', () => {
  it('rozpoznaje automatyczne adresy', () => {
    for (const a of ['noreply@x.pl', 'No-Reply@x.pl', 'no_reply@x.pl', 'donotreply@x.pl', 'do-not-reply@x.pl', 'noreply+abc@x.pl'])
      expect(isNoReply(a), a).toBe(true)
    for (const a of ['jan@x.pl', 'reply@x.pl', 'noreplyjan@x.pl', null]) expect(isNoReply(a), String(a)).toBe(false)
  })
})

describe('ustawienia AI', () => {
  it('ma domyślne wartości i waliduje nazwę modelu', () => {
    const db = setup()
    expect(getAiConfig(db)).toEqual({ enabled: true, provider: 'ollama', model: 'gemma3:4b' })
    expect(setAiConfig(db, { enabled: false, provider: 'ollama', model: 'qwen3:4b' })).toEqual({
      enabled: false,
      provider: 'ollama',
      model: 'qwen3:4b'
    })
    expect(() => setAiConfig(db, { enabled: true, provider: 'ollama', model: 'zły model; rm' })).toThrow()
    expect(() => setAiConfig(db, { enabled: true, provider: 'inny', model: 'x' })).toThrow(/dostawc/)
  })

  it('model w chmurze wymaga zgody, a model każdego dostawcy jest pamiętany osobno', () => {
    const db = setup()
    const cloud = { enabled: true, provider: 'anthropic', model: 'claude-haiku-5-5' }
    expect(() => setAiConfig(db, cloud)).toThrow(/zgod/)
    expect(getAiConfig(db).provider).toBe('ollama') // nieudany zapis niczego nie zmienia

    expect(setAiConfig(db, { ...cloud, consent: true })).toEqual(cloud)
    expect(getConsent(db, 'anthropic')).toBe(true)
    expect(getConsent(db, 'openai')).toBe(false)

    // zgoda jest zapamiętana, więc kolejne zapisy jej nie wymagają
    expect(setAiConfig(db, { ...cloud, model: 'claude-sonnet-5-5' }).model).toBe('claude-sonnet-5-5')
    // powrót do lokalnego modelu nie gubi modelu chmurowego i odwrotnie
    expect(setAiConfig(db, { enabled: true, provider: 'ollama', model: 'gemma3:4b' }).provider).toBe('ollama')
    expect(modelsByProvider(db)).toMatchObject({ ollama: 'gemma3:4b', anthropic: 'claude-sonnet-5-5', openai: 'gpt-4o-mini' })
  })

  it('stary zapis modelu Ollamy nadal działa', () => {
    const db = setup()
    setSetting(db, 'ai.model', 'llama3.2:3b')
    expect(getAiConfig(db)).toEqual({ enabled: true, provider: 'ollama', model: 'llama3.2:3b' })
  })
})

describe('grupa priorytetu', () => {
  const withPriority: Tag[] = [
    ...tags,
    { id: 3, name: 'Pilne', color: null, description: '', system: 'urgent' },
    { id: 4, name: 'Luźne', color: null, description: '', system: 'loose' },
    { id: 5, name: 'Zachować', color: null, description: '', system: 'keep' }
  ]

  it('schemat wymaga priorytetu i oddziela go od zwykłych tagów', () => {
    const schema = schemaFor(withPriority) as {
      required: string[]
      properties: { priority: { enum: string[] }; tags: { items: { enum: string[] } } }
    }
    expect(schema.required).toContain('priority')
    expect(schema.properties.priority.enum).toEqual(['Pilne', 'Luźne', 'Zachować'])
    expect(schema.properties.tags.items.enum).toEqual(['Rekrutacje', 'Rachunki'])
  })

  it('zwraca dokładnie jeden tag priorytetu, nawet gdy model poda więcej', () => {
    expect(parseTagIds('{"priority":"pilne","tags":["Rachunki","Luźne"]}', withPriority)).toEqual([3, 2])
    expect(parseTagIds('{"tags":["Luźne","Pilne"]}', withPriority)).toEqual([4])
  })

  it('zostawia najwyżej jeden tag poza priorytetem', () => {
    expect(parseTagIds('{"priority":"Luźne","tags":["Rachunki","Rekrutacje"]}', withPriority)).toEqual([4, 2])
  })

  it('odrzuca odpowiedź bez priorytetu', () => {
    expect(() => parseTagIds('{"tags":["Rachunki"]}', withPriority)).toThrow(/priorytetu/)
  })
})

describe('tag „Zachować”', () => {
  it('przenosi wiadomość z Odebranych do Archiwum i zgłasza to kolejce', async () => {
    const db = setup()
    const keep = listTags(db).find((t) => t.system === 'keep')!
    updateTag(db, keep.id, 'Na potem', null) // archiwizuje po kluczu, więc zmiana nazwy nic nie psuje
    const other = createTag(db, 'Praca', null)
    addMessage(db, 1, 1)
    addMessage(db, 2, 2)
    const onArchived = vi.fn()
    const classifier = createClassifier({
      db,
      config: () => ({ enabled: true, provider: 'ollama', model: 'm' }),
      classify: vi.fn(async (_t: Tag[], mail: { id: number }) => (mail.id === 2 ? [keep.id] : [other.id])),
      onArchived,
      now: () => NOW
    })
    classifier.kick()
    await vi.waitFor(() => expect(classifier.status().state).toBe('idle'))
    const folder = (id: number) => (db.prepare('SELECT folder FROM messages WHERE id = ?').get(id) as { folder: string }).folder
    expect(folder(2)).toBe('archive')
    expect(folder(1)).toBe('inbox')
    expect(onArchived).toHaveBeenCalledTimes(1)
  })
})
