import { describe, expect, it } from 'vitest'
import { toFtsQuery } from './messages'

describe('toFtsQuery', () => {
  it('zamienia słowa na prefiksy, które muszą wystąpić wszystkie', () => {
    expect(toFtsQuery('faktura  marzec')).toBe('"faktura"* "marzec"*')
  })

  it('usuwa cudzysłowy, żeby fraza nie psuła zapytania FTS', () => {
    expect(toFtsQuery('a"b OR "')).toBe('"ab"* "OR"*')
  })

  it('zwraca null dla pustej frazy', () => {
    expect(toFtsQuery('   ')).toBeNull()
  })
})
