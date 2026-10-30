import { useState } from 'react'

const KEY = 'zim.sidebarCollapsed'

/** Czy pasek boczny jest schowany; stan pamiętany między uruchomieniami. */
export function useSidebarCollapsed(): [boolean, () => void] {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(KEY) === '1'
    } catch {
      return false
    }
  })

  const toggle = (): void => {
    setCollapsed((prev) => {
      try {
        localStorage.setItem(KEY, prev ? '0' : '1')
      } catch {
        // brak zapisu = ustawienie tylko na tę sesję
      }
      return !prev
    })
  }

  return [collapsed, toggle]
}

export const SIDEBAR_SHORTCUT = /Mac/.test(navigator.userAgent) ? '⌘B' : 'Ctrl+B'
