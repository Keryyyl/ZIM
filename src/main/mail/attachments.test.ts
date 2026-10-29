import { mkdtemp, mkdir, readdir, rm, utimes, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import type { MessageStructureObject } from 'imapflow'
import { collectAttachments, isRisky, safeFilename } from './attachments'
import { pruneCache } from './attachment-cache'

describe('collectAttachments', () => {
  it('pomija treść maila i zbiera pliki z zagnieżdżonych części', () => {
    const structure: MessageStructureObject = {
      type: 'multipart/mixed',
      childNodes: [
        {
          part: '1',
          type: 'multipart/alternative',
          childNodes: [
            { part: '1.1', type: 'text/plain', size: 10 },
            { part: '1.2', type: 'text/html', size: 40 }
          ]
        },
        {
          part: '2',
          type: 'application/pdf',
          encoding: 'base64',
          size: 4000,
          disposition: 'attachment',
          dispositionParameters: { filename: 'CV.pdf' }
        },
        {
          part: '3',
          type: 'image/png',
          id: '<logo@firma>',
          disposition: 'inline',
          parameters: { name: 'logo.png' },
          size: 100
        }
      ]
    }
    expect(collectAttachments(structure)).toEqual([
      { part: '2', filename: 'CV.pdf', mime: 'application/pdf', size: 3000, contentId: null, inline: false },
      { part: '3', filename: 'logo.png', mime: 'image/png', size: 100, contentId: 'logo@firma', inline: true }
    ])
  })

  it('zwraca pustą listę dla zwykłego tekstu', () => {
    expect(collectAttachments({ type: 'text/plain', size: 5 })).toEqual([])
  })

  it('traktuje pojedynczą część bez numeru jako część "1"', () => {
    const [a] = collectAttachments({ type: 'application/pdf', size: 8, disposition: 'attachment' })
    expect(a.part).toBe('1')
    expect(a.filename).toBe('załącznik')
  })

  it('załączoną wiadomość traktuje jako jeden plik .eml', () => {
    const [a, ...rest] = collectAttachments({
      type: 'multipart/mixed',
      childNodes: [
        { part: '1', type: 'text/plain' },
        {
          part: '2',
          type: 'message/rfc822',
          size: 900,
          childNodes: [{ part: '2.1', type: 'text/plain' }]
        }
      ]
    })
    expect(a.part).toBe('2')
    expect(a.filename).toBe('wiadomość.eml')
    expect(rest).toEqual([])
  })
})

describe('safeFilename', () => {
  it('usuwa ścieżki i znaki sterujące', () => {
    expect(safeFilename('../../etc/passwd')).toBe('_.._etc_passwd')
    expect(safeFilename('.bashrc')).toBe('bashrc')
    expect(safeFilename('a\u0000b.txt')).toBe('ab.txt')
  })

  it('zastępuje pustą nazwę i skraca długą, zachowując rozszerzenie', () => {
    expect(safeFilename('   ')).toBe('załącznik')
    const long = safeFilename(`${'a'.repeat(300)}.pdf`)
    expect(long).toHaveLength(150)
    expect(long.endsWith('.pdf')).toBe(true)
  })
})

describe('isRisky', () => {
  it('rozpoznaje pliki wykonywalne po ostatnim rozszerzeniu', () => {
    expect(isRisky('faktura.pdf.exe')).toBe(true)
    expect(isRisky('Setup.DMG')).toBe(true)
    expect(isRisky('faktura.exe.')).toBe(true)
    expect(isRisky('CV.pdf')).toBe(false)
    expect(isRisky('Makefile')).toBe(false)
  })
})

describe('pruneCache', () => {
  it('usuwa najdawniej używane pliki, aż zmieszczą się w limicie', async () => {
    const root = await mkdtemp(join(tmpdir(), 'zim-cache-'))
    try {
      const dir = join(root, '1', '10')
      await mkdir(dir, { recursive: true })
      for (const [name, days] of [['stary', 3], ['sredni', 2], ['nowy', 1]] as const) {
        const path = join(dir, name)
        await writeFile(path, Buffer.alloc(100))
        const when = new Date(Date.now() - days * 86_400_000)
        await utimes(path, when, when)
      }
      // 300 B, limit 250 B -> cel 200 B: znika najstarszy
      await pruneCache(root, 250)
      expect((await readdir(dir)).sort()).toEqual(['nowy', 'sredni'])
      // limit nie przekroczony: nic się nie zmienia
      await pruneCache(root, 1000)
      expect((await readdir(dir)).sort()).toEqual(['nowy', 'sredni'])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
