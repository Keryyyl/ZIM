import { describe, expect, it } from 'vitest'
import { extractEmail } from './address'

describe('extractEmail', () => {
  it('wyciąga adres z nawiasów i zmienia na małe litery', () => {
    expect(extractEmail('Jan Kowalski <Jan.Kowalski@Example.PL>')).toBe('jan.kowalski@example.pl')
  })

  it('obsługuje sam adres', () => {
    expect(extractEmail('newsletter@shop.com')).toBe('newsletter@shop.com')
  })

  it('bierze adres z nawiasów, nawet gdy nazwa wygląda jak adres', () => {
    expect(extractEmail('"ktos@x.pl" <prawdziwy@y.pl>')).toBe('prawdziwy@y.pl')
  })

  it('zwraca null, gdy nie ma adresu', () => {
    expect(extractEmail('')).toBeNull()
    expect(extractEmail('Nieznany nadawca')).toBeNull()
  })
})
