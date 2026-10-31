import { useState } from 'react'

/** Foldery z paska bocznego. Ukrycie tylko chowa folder w UI, wiadomości dalej są w bazie i na serwerze. */
export type FolderId = 'inbox' | 'all' | 'starred' | 'archive' | 'spam' | 'trash' | 'scheduled'

export const FOLDERS: { id: FolderId; label: string; description: string; /** druga litera skrótu G + litera */ key: string; locked?: boolean }[] = [
  { id: 'inbox', key: 'i', label: 'Odebrane', description: 'Główna skrzynka', locked: true },
  { id: 'all', key: 'w', label: 'Wszystko', description: 'Odebrane i Archiwum razem' },
  { id: 'starred', key: 'o', label: 'Oznaczone gwiazdką', description: 'Wiadomości z gwiazdką' },
  { id: 'scheduled', key: 's', label: 'Zaplanowane', description: 'Wiadomości czekające na wysłanie' },
  { id: 'archive', key: 'a', label: 'Archiwum', description: 'Zarchiwizowane wiadomości' },
  { id: 'spam', key: 'p', label: 'Spam', description: 'Wiadomości oznaczone jako spam' },
  { id: 'trash', key: 't', label: 'Kosz', description: 'Usunięte wiadomości' }
]

const KEY = 'zim.hiddenFolders'
const IDS = new Set<string>(FOLDERS.filter((f) => !f.locked).map((f) => f.id))
// domyślnie widać tylko to, czego używa się codziennie
const DEFAULT_HIDDEN: FolderId[] = ['archive', 'spam', 'trash']

function load(): Set<FolderId> {
  try {
    const raw = localStorage.getItem(KEY)
    const list: unknown = raw === null ? DEFAULT_HIDDEN : JSON.parse(raw)
    return new Set((Array.isArray(list) ? list : []).filter((x): x is FolderId => IDS.has(x)))
  } catch {
    return new Set(DEFAULT_HIDDEN)
  }
}

export function useHiddenFolders(): [Set<FolderId>, (id: FolderId, hidden: boolean) => void] {
  const [hidden, setHidden] = useState(load)

  const set = (id: FolderId, isHidden: boolean): void => {
    setHidden((prev) => {
      const next = new Set(prev)
      if (isHidden) next.add(id)
      else next.delete(id)
      try {
        localStorage.setItem(KEY, JSON.stringify([...next]))
      } catch {
        // brak zapisu = ustawienie tylko na tę sesję
      }
      return next
    })
  }

  return [hidden, set]
}
