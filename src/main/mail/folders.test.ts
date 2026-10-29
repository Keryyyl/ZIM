import { describe, expect, it } from 'vitest'
import { folderOf, packUids, pickFolders } from './folders'

describe('pickFolders', () => {
  it('Gmail: archiwum to All Mail', () => {
    const { folders, missing } = pickFolders(
      [
        { path: 'INBOX', specialUse: '\\Inbox' },
        { path: '[Gmail]/All Mail', specialUse: '\\All' },
        { path: '[Gmail]/Spam', specialUse: '\\Junk' },
        { path: '[Gmail]/Trash', specialUse: '\\Trash' }
      ],
      true
    )
    expect(folders).toMatchObject({ archive: '[Gmail]/All Mail', spam: '[Gmail]/Spam', trash: '[Gmail]/Trash' })
    expect(missing).toEqual([])
  })

  it('inny serwer: \\Archive, a brakujące foldery do założenia', () => {
    const { folders, missing } = pickFolders(
      [
        { path: 'INBOX' },
        { path: 'Kosz', specialUse: '\\Trash' },
        { path: 'Wszystkie', specialUse: '\\All' }
      ],
      false
    )
    expect(folders.trash).toBe('Kosz')
    expect(folders.archive).toBe('Archive')
    expect(missing).toEqual(['archive', 'spam'])
  })
})

describe('folderOf', () => {
  const { folders } = pickFolders(
    [
      { path: 'Junk', specialUse: '\\Junk' },
      { path: 'Trash', specialUse: '\\Trash' },
      { path: 'Archive', specialUse: '\\Archive' }
    ],
    false
  )
  it('mapuje ścieżki na foldery ZIM', () => {
    expect(folderOf(folders, 'INBOX')).toBe('inbox')
    expect(folderOf(folders, 'Junk')).toBe('spam')
    expect(folderOf(folders, 'Trash')).toBe('trash')
    expect(folderOf(folders, 'Archive')).toBe('archive')
    expect(folderOf(folders, 'Projekty/2026')).toBe('archive')
  })
})

describe('packUids', () => {
  it('łączy kolejne UID w zakresy', () => {
    expect(packUids([9, 1, 2, 3, 5, 7, 8, 3])).toBe('1:3,5,7:9')
  })
  it('pojedynczy UID', () => {
    expect(packUids([42])).toBe('42')
  })
})
