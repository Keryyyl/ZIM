/**
 * Własne motywy to plik JSON z wartościami zmiennych CSS (np. "bg", "accent"). Nie wstrzykujemy tekstu do CSS:
 * każda wartość musi być kolorem w prostej, sprawdzonej postaci, a klucze muszą być na liście poniżej.
 */
export interface ThemeVar {
  key: string
  label: string
}

export const THEME_VARS: ThemeVar[] = [
  { key: 'accent', label: 'Akcent: przyciski, zaznaczenia, aktywne elementy' },
  { key: 'on-accent', label: 'Tekst na tle akcentu' },
  { key: 'bg', label: 'Tło aplikacji' },
  { key: 'bg-elevated', label: 'Tło okien, menu i wyskakujących paneli' },
  { key: 'text', label: 'Główny kolor tekstu' },
  { key: 'muted', label: 'Tekst drugorzędny, podpisy' },
  { key: 'border', label: 'Ramki i linie' },
  { key: 'sidebar', label: 'Tło pasków bocznych' },
  { key: 'hover', label: 'Tło elementu po najechaniu' },
  { key: 'selected', label: 'Tło zaznaczonego elementu' },
  { key: 'danger', label: 'Kolor błędów i usuwania' },
  { key: 'row-from', label: 'Lista maili: nadawca (nieprzeczytane)' },
  { key: 'row-subject', label: 'Lista maili: temat (nieprzeczytane)' },
  { key: 'row-snippet', label: 'Lista maili: początek treści (nieprzeczytane)' },
  { key: 'row-date', label: 'Lista maili: data' },
  { key: 'row-hover', label: 'Lista maili: tło wiersza po najechaniu' },
  { key: 'row-line', label: 'Lista maili: linie między wierszami' },
  { key: 'row-read-from', label: 'Lista maili: nadawca (przeczytane)' },
  { key: 'row-read-subject', label: 'Lista maili: temat (przeczytane)' },
  { key: 'row-read-snippet', label: 'Lista maili: początek treści (przeczytane)' },
  { key: 'badge-bg', label: 'Tło małych plakietek (np. nazwa skrzynki)' },
  { key: 'badge-text', label: 'Tekst małych plakietek' },
  { key: 'nav-text', label: 'Menu boczne: tekst' },
  { key: 'nav-active-text', label: 'Menu boczne: tekst aktywnej pozycji' },
  { key: 'nav-active-bg', label: 'Menu boczne: tło aktywnej pozycji' },
  { key: 'hint', label: 'Podpowiedzi i skróty w menu' },
  { key: 'compose-bg', label: 'Przycisk nowej wiadomości: tło' },
  { key: 'compose-border', label: 'Przycisk nowej wiadomości: ramka' },
  { key: 'compose-text', label: 'Przycisk nowej wiadomości: tekst' },
  { key: 'tab-text', label: 'Zakładki: tekst' },
  { key: 'tab-hover', label: 'Zakładki: po najechaniu' },
  { key: 'tab-active', label: 'Zakładki: aktywna' }
]

const KEYS = new Set(THEME_VARS.map((v) => v.key))
export const FORMAT = 'zim-theme'
export const NAME_MAX = 40
const FILE_MAX = 30_000

// #rgb, #rgba, #rrggbb, #rrggbbaa, rgb()/rgba()/hsl()/hsla() z samymi liczbami oraz słowo transparent
const COLOR = /^(#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})|(rgb|hsl)a?\([0-9a-z.,%\s/-]{1,60}\)|transparent)$/i

export const isColor = (value: unknown): value is string => typeof value === 'string' && COLOR.test(value.trim())

export type ThemeBase = 'light' | 'dark'

export interface CustomTheme {
  id: string
  name: string
  /** Motyw bazowy: z niego bierze się schemat kolorów (jasny/ciemny) i wszystko, czego plik nie nadpisuje */
  base: ThemeBase
  colors: Record<string, string>
}

export type ParsedTheme = Omit<CustomTheme, 'id'>

export function cleanName(value: unknown): string {
  const name = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : ''
  if (!name) throw new Error('Podaj nazwę motywu')
  if (name.length > NAME_MAX) throw new Error(`Nazwa motywu może mieć najwyżej ${NAME_MAX} znaków`)
  return name
}

/** Waliduje dane motywu (z pliku albo z zapisu lokalnego); rzuca błąd z opisem po polsku. */
export function validateTheme(data: unknown): ParsedTheme {
  if (data === null || typeof data !== 'object') throw new Error('To nie jest plik motywu ZIM')
  const obj = data as { format?: unknown; name?: unknown; base?: unknown; colors?: unknown }
  if (obj.format !== FORMAT) throw new Error('To nie jest plik motywu ZIM')
  const name = cleanName(obj.name)
  if (obj.base !== 'light' && obj.base !== 'dark') throw new Error('Pole „base” musi mieć wartość „light” albo „dark”')
  if (obj.colors === null || typeof obj.colors !== 'object' || Array.isArray(obj.colors)) {
    throw new Error('Brakuje sekcji „colors” z kolorami')
  }
  const colors: Record<string, string> = {}
  for (const [key, value] of Object.entries(obj.colors)) {
    if (!KEYS.has(key)) throw new Error(`Nieznany kolor „${key}”`)
    if (!isColor(value)) throw new Error(`Niepoprawna wartość koloru „${key}”: użyj np. #1a1a1a albo rgba(0, 0, 0, 0.5)`)
    colors[key] = value.trim()
  }
  if (Object.keys(colors).length === 0) throw new Error('Plik nie zawiera żadnego koloru')
  return { name, base: obj.base, colors }
}

export function parseThemeFile(text: string): ParsedTheme {
  if (text.length > FILE_MAX) throw new Error('Plik jest za duży jak na motyw')
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error('Plik nie jest poprawnym JSON-em')
  }
  return validateTheme(data)
}

/**
 * Plik do pobrania: wszystkie dostępne kolory z aktualnymi wartościami (`read` zwraca bieżącą wartość zmiennej),
 * żeby można było zacząć od tego, co widać na ekranie. Sekcja „opisy” jest tylko podpowiedzią i przy wczytaniu jest pomijana.
 */
export function buildTemplate(base: ThemeBase, read: (key: string) => string): string {
  const colors: Record<string, string> = {}
  for (const { key } of THEME_VARS) {
    const value = read(key).trim()
    if (isColor(value)) colors[key] = value
  }
  const opisy = Object.fromEntries(THEME_VARS.map((v) => [v.key, v.label]))
  return JSON.stringify({ format: FORMAT, name: 'Mój motyw', base, colors, opisy }, null, 2) + '\n'
}

/** Nazwa unikalna na liście: „Nazwa”, „Nazwa (2)”, … */
export function uniqueName(name: string, taken: string[]): string {
  const used = new Set(taken.map((n) => n.toLowerCase()))
  if (!used.has(name.toLowerCase())) return name
  for (let i = 2; ; i++) {
    const candidate = `${name.slice(0, NAME_MAX - 5)} (${i})`
    if (!used.has(candidate.toLowerCase())) return candidate
  }
}
