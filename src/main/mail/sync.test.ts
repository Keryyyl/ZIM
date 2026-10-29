import { describe, expect, it } from 'vitest'
import { makeSnippet } from './sync'

describe('makeSnippet', () => {
  it('skraca do podanej liczby słów i scala białe znaki', () => {
    expect(makeSnippet('Cześć,\n\n  jak   się masz? Dawno nie gadaliśmy.', 4)).toBe('Cześć, jak się masz?…')
  })

  it('pomija cytowane linie', () => {
    expect(makeSnippet('Jasne, pasuje.\n> W dniu wtorek Jan napisał:\n> spotkanie?')).toBe('Jasne, pasuje.')
  })

  it('zwraca pusty tekst dla pustej treści', () => {
    expect(makeSnippet('')).toBe('')
  })
})
