import { describe, expect, it } from 'vitest'
import { THEME_VARS, buildTemplate, isColor, parseThemeFile, uniqueName } from './customTheme'

const file = (over: object = {}): string =>
  JSON.stringify({ format: 'zim-theme', name: 'Noc', base: 'dark', colors: { bg: '#000', accent: 'rgb(10, 20, 30)' }, ...over })

describe('isColor', () => {
  it('przyjmuje proste kolory', () => {
    for (const c of ['#fff', '#ffff', '#1a1a1a', '#1a1a1a80', 'rgba(0, 0, 0, 0.5)', 'rgb(1 2 3 / 50%)', 'hsl(200, 50%, 40%)', 'transparent']) {
      expect(isColor(c), c).toBe(true)
    }
  })

  it('odrzuca wszystko, co mogłoby wyjść poza wartość koloru', () => {
    for (const c of ['red; background: url(x)', 'url(http://x)', '#12', '#ggg', 'rgb(0,0,0); x', 'var(--bg)', 'expression(1)', '', 5, null]) {
      expect(isColor(c), String(c)).toBe(false)
    }
  })
})

describe('parseThemeFile', () => {
  it('wczytuje poprawny motyw', () => {
    expect(parseThemeFile(file())).toEqual({ name: 'Noc', base: 'dark', colors: { bg: '#000', accent: 'rgb(10, 20, 30)' } })
  })

  it('zgłasza czytelne błędy', () => {
    expect(() => parseThemeFile('nie json')).toThrow(/JSON/)
    expect(() => parseThemeFile('[]')).toThrow(/nie jest plik/)
    expect(() => parseThemeFile(file({ format: 'inny' }))).toThrow(/nie jest plik/)
    expect(() => parseThemeFile(file({ name: '   ' }))).toThrow(/nazwę/)
    expect(() => parseThemeFile(file({ name: 'x'.repeat(41) }))).toThrow(/najwyżej/)
    expect(() => parseThemeFile(file({ base: 'szary' }))).toThrow(/base/)
    expect(() => parseThemeFile(file({ colors: { bg: 'zielony' } }))).toThrow(/„bg”/)
    expect(() => parseThemeFile(file({ colors: { tlo: '#000' } }))).toThrow(/Nieznany kolor „tlo”/)
    expect(() => parseThemeFile(file({ colors: {} }))).toThrow(/żadnego koloru/)
    expect(() => parseThemeFile(file({ colors: { bg: '#000; } body { display: none' } }))).toThrow(/„bg”/)
  })
})

describe('buildTemplate', () => {
  it('zawiera wszystkie kolory z bieżącymi wartościami i da się go wczytać z powrotem', () => {
    const text = buildTemplate('dark', (key) => (key === 'bg' ? ' #101010 ' : '#abcdef'))
    const data = JSON.parse(text)
    expect(Object.keys(data.colors)).toEqual(THEME_VARS.map((v) => v.key))
    expect(data.colors.bg).toBe('#101010')
    expect(Object.keys(data.opisy)).toEqual(Object.keys(data.colors))
    expect(parseThemeFile(text).base).toBe('dark')
  })

  it('pomija wartości, których nie da się odczytać jako kolor', () => {
    const data = JSON.parse(buildTemplate('light', (key) => (key === 'bg' ? '' : '#fff')))
    expect(data.colors).not.toHaveProperty('bg')
  })
})

describe('uniqueName', () => {
  it('dodaje numer, gdy nazwa jest zajęta (bez względu na wielkość liter)', () => {
    expect(uniqueName('Noc', [])).toBe('Noc')
    expect(uniqueName('Noc', ['noc'])).toBe('Noc (2)')
    expect(uniqueName('Noc', ['Noc', 'Noc (2)'])).toBe('Noc (3)')
  })
})
