import { useEffect, useState } from 'react'
import { THEME_VARS, cleanName, uniqueName, validateTheme, type CustomTheme, type ParsedTheme } from './customTheme'

export type ThemeMode = 'system' | 'light' | 'dark' | 'custom'

/** Kolor akcentu nie jest wybierany: jasny motyw ma fioletowy, ciemny turkusowy (zmienne --accent w styles.css). */
export interface Theme {
  mode: ThemeMode
  /** Dla mode = 'custom': który z własnych motywów jest w użyciu */
  customId?: string
}

const KEY = 'zim.theme'
const CUSTOM_KEY = 'zim.customThemes'
const DEFAULT: Theme = { mode: 'system' }

function load(): Theme {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}') as { mode?: unknown; customId?: unknown }
    if (saved.mode === 'light' || saved.mode === 'dark' || saved.mode === 'system') return { mode: saved.mode }
    if (saved.mode === 'custom' && typeof saved.customId === 'string') return { mode: 'custom', customId: saved.customId }
  } catch {
    // uszkodzony zapis = motyw domyślny
  }
  return DEFAULT
}

function loadCustom(): CustomTheme[] {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(CUSTOM_KEY) ?? '[]')
    if (!Array.isArray(saved)) return []
    return saved.flatMap((item) => {
      try {
        // zapis lokalny przechodzi tę samą walidację co plik, więc nic obcego nie trafi do stylów
        return [{ id: String((item as { id?: unknown }).id), ...validateTheme({ format: 'zim-theme', ...item }) }]
      } catch {
        return []
      }
    })
  } catch {
    return []
  }
}

export interface CustomThemes {
  themes: CustomTheme[]
  /** Dodaje motyw z pliku; zwraca zapisany (z unikalną nazwą) */
  add: (theme: ParsedTheme) => CustomTheme
  rename: (id: string, name: string) => void
  remove: (id: string) => void
}

export function useCustomThemes(): CustomThemes {
  const [themes, setThemes] = useState(loadCustom)

  const persist = (next: CustomTheme[]): void => {
    setThemes(next)
    try {
      localStorage.setItem(CUSTOM_KEY, JSON.stringify(next))
    } catch {
      // brak zapisu = motywy tylko na tę sesję
    }
  }

  return {
    themes,
    add(theme) {
      const created: CustomTheme = {
        id: crypto.randomUUID(),
        ...theme,
        name: uniqueName(theme.name, themes.map((t) => t.name))
      }
      persist([...themes, created])
      return created
    },
    rename(id, name) {
      const clean = cleanName(name)
      const taken = themes.filter((t) => t.id !== id).map((t) => t.name)
      if (taken.some((n) => n.toLowerCase() === clean.toLowerCase())) throw new Error('Motyw o takiej nazwie już istnieje')
      persist(themes.map((t) => (t.id === id ? { ...t, name: clean } : t)))
    },
    remove: (id) => persist(themes.filter((t) => t.id !== id))
  }
}

export function useTheme(custom: CustomTheme[]): [Theme, (t: Theme) => void] {
  const [theme, setTheme] = useState(load)
  const active = theme.mode === 'custom' ? custom.find((t) => t.id === theme.customId) : undefined

  useEffect(() => {
    const root = document.documentElement
    for (const { key } of THEME_VARS) root.style.removeProperty(`--${key}`)
    if (active) {
      // motyw bazowy daje schemat kolorów i wartości, których plik nie nadpisuje
      root.dataset.theme = active.base
      for (const [key, value] of Object.entries(active.colors)) root.style.setProperty(`--${key}`, value)
    } else if (theme.mode === 'light' || theme.mode === 'dark') {
      root.dataset.theme = theme.mode
    } else {
      delete root.dataset.theme
    }
  }, [theme.mode, active])

  // używany motyw został usunięty (albo zapis się zgubił): wracamy do systemowego
  useEffect(() => {
    if (theme.mode === 'custom' && !active) setTheme(DEFAULT)
  }, [theme.mode, active])

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(theme))
    } catch {
      // brak zapisu = motyw tylko na tę sesję
    }
  }, [theme])

  return [theme, setTheme]
}
