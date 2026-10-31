/**
 * Wbudowane tagi ważności: każda wiadomość ma najwyżej jeden z nich. Są w bazie od pierwszego uruchomienia
 * i nie da się ich usunąć, ale nazwę, kolor i opis dla AI użytkownik może zmienić, dlatego logika
 * rozpoznaje je po trwałym kluczu (`tags.system_key`), a nie po nazwie.
 */
export type SystemTagKey = 'urgent' | 'loose' | 'keep'

export interface SystemTagDef {
  key: SystemTagKey
  name: string
  color: string
  description: string
}

/** Kolejność = kolejność na liście tagów po pierwszym uruchomieniu */
export const SYSTEM_TAGS: SystemTagDef[] = [
  {
    key: 'urgent',
    name: 'Pilne',
    color: '#ef4444',
    description: 'wymaga szybkiej reakcji albo decyzji: terminy, prośby od ludzi, ważne sprawy służbowe i osobiste'
  },
  {
    key: 'loose',
    name: 'Luźne',
    color: '#3b82f6',
    description: 'zwykła korespondencja bez pośpiechu: powiadomienia, newslettery, marketing, automatyczne potwierdzenia'
  },
  {
    key: 'keep',
    name: 'Zachować',
    color: '#10b981',
    description:
      'nie wymaga reakcji, ale warto mieć na później: faktury, rachunki, bilety, potwierdzenia zamówień; trafia od razu do Archiwum'
  }
]

/** Miejsce w Odebranych: 0 = na górze; wiadomości bez tagu ważności lądują na pozycji 2 (przed „keep”) */
export const INBOX_RANK: Record<SystemTagKey, number> = { urgent: 0, loose: 1, keep: 3 }
export const NO_PRIORITY_RANK = 2

export const isSystemKey = (value: unknown): value is SystemTagKey => SYSTEM_TAGS.some((t) => t.key === value)
