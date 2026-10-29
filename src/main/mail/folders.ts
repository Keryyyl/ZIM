import type { Folder } from '@shared/types'

/** Ścieżki folderów ZIM na konkretnym serwerze IMAP */
export interface ServerFolders {
  inbox: string
  archive: string
  spam: string
  trash: string
  /** Gmail: archiwum to "All Mail", które zawiera też wiadomości z INBOX */
  gmail: boolean
}

export interface ListedMailbox {
  path: string
  specialUse?: string
}

/** Foldery do utworzenia, gdy serwer nie ma odpowiednika */
export const DEFAULT_PATHS = { archive: 'Archive', spam: 'Spam', trash: 'Trash' } as const

/**
 * Dobiera foldery po flagach special-use (imapflow rozpoznaje je też po typowych
 * nazwach, np. "Kosz", "Deleted Items"). Brakujące zwraca jako `missing`.
 */
export function pickFolders(
  list: ListedMailbox[],
  gmail: boolean
): { folders: ServerFolders; missing: (keyof typeof DEFAULT_PATHS)[] } {
  const byUse = (use: string): string | undefined => list.find((m) => m.specialUse === use)?.path
  const byName = (name: string): string | undefined =>
    list.find((m) => m.path.toLowerCase() === name.toLowerCase())?.path

  // w Gmailu archiwizacja = zdjęcie etykiety Inbox, wiadomość zostaje w All Mail
  const archive = gmail ? (byUse('\\All') ?? byUse('\\Archive')) : (byUse('\\Archive') ?? byName('Archive'))
  const spam = byUse('\\Junk')
  const trash = byUse('\\Trash')

  const missing: (keyof typeof DEFAULT_PATHS)[] = []
  if (!archive) missing.push('archive')
  if (!spam) missing.push('spam')
  if (!trash) missing.push('trash')

  return {
    folders: {
      inbox: 'INBOX',
      archive: archive ?? DEFAULT_PATHS.archive,
      spam: spam ?? DEFAULT_PATHS.spam,
      trash: trash ?? DEFAULT_PATHS.trash,
      gmail
    },
    missing
  }
}

/** Folder ZIM odpowiadający ścieżce na serwerze; nieznana ścieżka = archiwum */
export function folderOf(folders: ServerFolders, mailbox: string): Folder {
  if (mailbox.toUpperCase() === 'INBOX') return 'inbox'
  if (mailbox === folders.trash) return 'trash'
  if (mailbox === folders.spam) return 'spam'
  return 'archive'
}

export function pathOf(folders: ServerFolders, folder: Folder): string {
  return folders[folder]
}

/** "1,2,3,5,7,8,9" -> "1:3,5,7:9", żeby duże zaznaczenia mieściły się w jednej komendzie IMAP */
export function packUids(uids: number[]): string {
  const sorted = [...new Set(uids)].sort((a, b) => a - b)
  const parts: string[] = []
  for (let i = 0; i < sorted.length; i++) {
    const start = sorted[i]
    while (i + 1 < sorted.length && sorted[i + 1] === sorted[i] + 1) i++
    parts.push(start === sorted[i] ? String(start) : `${start}:${sorted[i]}`)
  }
  return parts.join(',')
}
