import { useState } from 'react'

export type ShortcutAction = 'next' | 'prev' | 'archive' | 'reply' | 'search' | 'settings'

export const SHORTCUT_ACTIONS: { id: ShortcutAction; label: string; default: string }[] = [
  { id: 'next', label: 'Następna wiadomość', default: 'j' },
  { id: 'prev', label: 'Poprzednia wiadomość', default: 'k' },
  { id: 'archive', label: 'Archiwizuj', default: 'e' },
  { id: 'reply', label: 'Odpowiedz', default: 'r' },
  { id: 'search', label: 'Szukaj wiadomości', default: '/' },
  { id: 'settings', label: 'Ustawienia aplikacji', default: ',' }
]

export type ShortcutMap = Record<ShortcutAction, string>

const KEY = 'zim.shortcuts'
const DEFAULTS = Object.fromEntries(SHORTCUT_ACTIONS.map((a) => [a.id, a.default])) as ShortcutMap

function load(): ShortcutMap {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}')
    const map = { ...DEFAULTS }
    for (const a of SHORTCUT_ACTIONS) {
      const key = (saved as Record<string, unknown>)?.[a.id]
      if (typeof key === 'string' && key.length === 1) map[a.id] = key
    }
    return map
  } catch {
    return DEFAULTS
  }
}

/** Skróty to pojedyncze znaki (e.key), więc działają niezależnie od układu klawiatury. */
export function useShortcuts(): [ShortcutMap, (action: ShortcutAction, key: string) => void] {
  const [map, setMap] = useState(load)

  const set = (action: ShortcutAction, key: string): void => {
    setMap((prev) => {
      const next = { ...prev, [action]: key }
      // ten sam znak nie może obsługiwać dwóch akcji: druga dostaje poprzedni skrót zmienianej
      const other = SHORTCUT_ACTIONS.find((a) => a.id !== action && prev[a.id] === key)
      if (other) next[other.id] = prev[action]
      try {
        localStorage.setItem(KEY, JSON.stringify(next))
      } catch {
        // brak zapisu = skróty tylko na tę sesję
      }
      return next
    })
  }

  return [map, set]
}
