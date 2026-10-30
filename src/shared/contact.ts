/** Konto kontaktu w zewnętrznym serwisie, np. { service: 'LinkedIn', username: 'jan-kowalski' } */
export interface ContactService {
  service: string
  username: string
}

export interface ContactInit {
  /** null = jeszcze niezapisany w bazie */
  id?: number | null
  /** Zdjęcie: ścieżka, URL albo data URL; null = brak */
  photo?: string | null
  /** Jeden napis: "Imię Nazwisko" albo nazwa firmy */
  name: string
  email: string
  city?: string
  /** Skrótowy opis, np. "Księgowa, faktury za usługi" */
  description?: string
  services?: ContactService[]
}

export class Contact {
  id: number | null
  photo: string | null
  name: string
  email: string
  city: string
  description: string
  services: ContactService[]

  constructor(init: ContactInit) {
    this.id = init.id ?? null
    this.name = init.name.trim()
    this.email = init.email.trim().toLowerCase()
    if (!this.name) throw new Error('Kontakt musi mieć imię i nazwisko albo nazwę firmy')
    if (!/^[^\s@]+@[^\s@]+$/.test(this.email)) throw new Error('Nieprawidłowy adres e-mail')
    this.photo = init.photo ?? null
    this.city = init.city?.trim() ?? ''
    this.description = init.description?.trim() ?? ''
    this.services = (init.services ?? []).map((s) => ({ service: s.service.trim(), username: s.username.trim() }))
  }

  /** Dodaje konto w serwisie; to samo konto drugi raz jest pomijane. */
  addService(service: string, username: string): void {
    const entry = { service: service.trim(), username: username.trim() }
    if (!entry.service || !entry.username) throw new Error('Serwis i nazwa w serwisie są wymagane')
    const same = (s: ContactService): boolean =>
      s.service.toLowerCase() === entry.service.toLowerCase() && s.username === entry.username
    if (!this.services.some(same)) this.services.push(entry)
  }

  removeService(service: string, username: string): void {
    this.services = this.services.filter((s) => !(s.service.toLowerCase() === service.toLowerCase() && s.username === username))
  }

  /** Do zapisu w bazie lub przesłania przez IPC (klasa nie przechodzi przez IPC, zwykły obiekt tak). */
  toJSON(): ContactInit {
    return {
      id: this.id,
      photo: this.photo,
      name: this.name,
      email: this.email,
      city: this.city,
      description: this.description,
      services: this.services.map((s) => ({ ...s }))
    }
  }
}

/** Inicjały do zdjęcia zastępczego: pierwsze litery pierwszych dwóch słów ("Jan Kowalski" -> "JK", "ACME" -> "A"). */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  return words
    .slice(0, 2)
    .map((w) => Array.from(w)[0].toUpperCase())
    .join('')
}

const SERVICE_URLS: Record<string, (user: string) => string> = {
  linkedin: (u) => `https://www.linkedin.com/in/${u}`,
  github: (u) => `https://github.com/${u}`,
  gitlab: (u) => `https://gitlab.com/${u}`,
  x: (u) => `https://x.com/${u}`,
  twitter: (u) => `https://x.com/${u}`,
  instagram: (u) => `https://www.instagram.com/${u}`,
  facebook: (u) => `https://www.facebook.com/${u}`,
  youtube: (u) => `https://www.youtube.com/@${u}`,
  tiktok: (u) => `https://www.tiktok.com/@${u}`,
  telegram: (u) => `https://t.me/${u}`,
  whatsapp: (u) => `https://wa.me/${u.replace(/\D/g, '')}`
}

/** Adres profilu w znanym serwisie; null, gdy serwis jest nieznany (wtedy pokazujemy sam tekst). */
export function serviceUrl({ service, username }: ContactService): string | null {
  if (/^https?:\/\//i.test(username)) return username
  const build = SERVICE_URLS[service.trim().toLowerCase()]
  return build ? build(encodeURIComponent(username.trim().replace(/^@/, ''))) : null
}

/** Ostatnia wiadomość wymieniona z kontaktem, w którąkolwiek stronę */
export interface ContactMail {
  id: number
  subject: string
  date: number
  direction: 'received' | 'sent'
}
