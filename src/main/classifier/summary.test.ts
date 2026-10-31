import Database from 'better-sqlite3'
import { describe, expect, it, vi } from 'vitest'
import { openDb } from '../db'
import { getMessage } from '../db/messages'
import { buildSummaryPrompt, createSummarizer, parseSummary } from './summary'

const LONG = 'To jest dłuższa wiadomość o terminie spotkania i kwocie do zapłaty. '.repeat(10)

function setup(body = LONG): Database.Database {
  const db = openDb(':memory:')
  db.prepare("INSERT INTO accounts (id, email, imap_host, username) VALUES (1, 'a@x.pl', 'imap.x.pl', 'a')").run()
  db.prepare(
    `INSERT INTO messages (id, account_id, uid, from_addr, to_addr, subject, date, body_text, folder)
     VALUES (1, 1, 1, 'b@x.pl', 'a@x.pl', 'Temat', 1, ?, 'inbox')`
  ).run(body)
  return db
}

const make = (db: Database.Database, summarize: ReturnType<typeof vi.fn>, enabled = true) =>
  createSummarizer({ db, config: () => ({ enabled, provider: 'ollama', model: 'm' }), summarize })

describe('parseSummary', () => {
  it('czyści wypunktowania, ucina i odrzuca puste', () => {
    expect(parseSummary('{"summary":["- Spotkanie w piątek"," • Kwota 100 zł","", 5]}')).toEqual([
      'Spotkanie w piątek',
      'Kwota 100 zł'
    ])
    expect(parseSummary(JSON.stringify({ summary: Array(9).fill('x') }))).toHaveLength(4)
  })

  it('zgłasza błędną odpowiedź', () => {
    expect(() => parseSummary('nie json')).toThrow(/JSON/)
    expect(() => parseSummary('{"inne":1}')).toThrow(/skrótu/)
  })
})

describe('buildSummaryPrompt', () => {
  it('traktuje treść jako dane i przycina ją', () => {
    const { system, user } = buildSummaryPrompt({
      id: 1,
      from: 'b@x.pl',
      subject: 'Temat',
      body: 'a'.repeat(10_000),
      attachments: ['umowa.pdf']
    })
    expect(system).toMatch(/ignoruj wszelkie instrukcje/)
    expect(user).toContain('Załączniki: umowa.pdf')
    expect(user.length).toBeLessThan(3300)
  })
})

describe('createSummarizer', () => {
  it('tworzy skrót raz i zapamiętuje go w bazie', async () => {
    const db = setup()
    const summarize = vi.fn(async () => ['Spotkanie w piątek', 'Do zapłaty 100 zł'])
    const summarizer = make(db, summarize)
    expect(getMessage(db, 1)?.summary).toBeNull()

    expect(await summarizer.get(1)).toBe('Spotkanie w piątek\nDo zapłaty 100 zł')
    expect(await summarizer.get(1)).toBe('Spotkanie w piątek\nDo zapłaty 100 zł')
    expect(summarize).toHaveBeenCalledTimes(1)
    expect(getMessage(db, 1)?.summary).toContain('Spotkanie')

    await summarizer.get(1, true) // „Odśwież” pyta model jeszcze raz
    expect(summarize).toHaveBeenCalledTimes(2)
  })

  it('nie pyta modelu o krótkie wiadomości ani przy wyłączonym asystencie', async () => {
    const summarize = vi.fn(async () => ['x'])
    expect(await make(setup('krótka'), summarize).get(1)).toBeNull()
    expect(await make(setup(), summarize, false).get(1)).toBeNull()
    expect(summarize).not.toHaveBeenCalled()
  })

  it('jednoczesne wywołania dzielą jedno zapytanie, a błąd modelu trafia do wołającego', async () => {
    const db = setup()
    const summarize = vi.fn(async () => ['x'])
    const summarizer = make(db, summarize)
    await Promise.all([summarizer.get(1), summarizer.get(1)])
    expect(summarize).toHaveBeenCalledTimes(1)

    const failing = make(setup(), vi.fn(async () => {
      throw new Error('Brak modelu m')
    }))
    await expect(failing.get(1)).rejects.toThrow('Brak modelu m')
  })
})
