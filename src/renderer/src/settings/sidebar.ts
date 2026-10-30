import { useState } from 'react'

const LEFT_KEY = 'zim.sidebarCollapsed'
const RIGHT_KEY = 'zim.rightSidebarCollapsed'

/** Czy pasek boczny jest schowany; stan pamiętany między uruchomieniami. */
export function useSidebarCollapsed(): [boolean, () => void] {
  return useCollapsed(LEFT_KEY)
}

/** To samo dla prawego paska; domyślnie widoczny. */
export function useRightSidebarCollapsed(): [boolean, () => void] {
  return useCollapsed(RIGHT_KEY)
}

function useCollapsed(KEY: string): [boolean, () => void] {
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

const MAC = /Mac/.test(navigator.userAgent)
export const SIDEBAR_SHORTCUT = MAC ? '⌘B' : 'Ctrl+B'
export const RIGHT_SIDEBAR_SHORTCUT = MAC ? '⇧⌘B' : 'Ctrl+Shift+B'
