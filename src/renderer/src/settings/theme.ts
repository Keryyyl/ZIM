import { useEffect, useState } from 'react'

export type ThemeMode = 'system' | 'light' | 'dark'

export const ACCENTS = [
  { name: 'Niebieski', value: '#3b82f6' },
  { name: 'Fioletowy', value: '#8b5cf6' },
  { name: 'Zielony', value: '#10b981' },
  { name: 'Pomarańczowy', value: '#f97316' },
  { name: 'Różowy', value: '#ec4899' },
  { name: 'Grafitowy', value: '#64748b' }
]

export interface Theme {
  mode: ThemeMode
  accent: string
}

const KEY = 'zim.theme'
const DEFAULT: Theme = { mode: 'system', accent: ACCENTS[0].value }

function load(): Theme {
  try {
    return { ...DEFAULT, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }
  } catch {
    return DEFAULT
  }
}

export function useTheme(): [Theme, (t: Theme) => void] {
  const [theme, setTheme] = useState(load)

  useEffect(() => {
    const root = document.documentElement
    if (theme.mode === 'system') delete root.dataset.theme
    else root.dataset.theme = theme.mode
    root.style.setProperty('--accent', theme.accent)
    try {
      localStorage.setItem(KEY, JSON.stringify(theme))
    } catch {
      // brak zapisu = motyw tylko na tę sesję
    }
  }, [theme])

  return [theme, setTheme]
}
