import { describe, expect, it } from 'vitest'
import { applyRules } from './engine'
import type { Rule } from '@shared/types'

const rule: Rule = {
  id: 1,
  name: 'Potwierdzenie aplikacji',
  match: 'any',
  conditions: [
    { field: 'subject', op: 'contains', value: 'Dziękujemy za złożenie' },
    { field: 'subject', op: 'contains', value: 'Thank you for applying' }
  ],
  addTags: ['rekrutacja/potwierdzenie'],
  setPriority: 'noise',
  enabled: true
}

describe('applyRules', () => {
  it('taguje potwierdzenie aplikacji', () => {
    const res = applyRules(
      { from: 'hr@firma.pl', to: 'ja@x.pl', subject: 'Dziękujemy za złożenie aplikacji', body: '', headers: {} },
      [rule]
    )
    expect(res.tags).toEqual(['rekrutacja/potwierdzenie'])
    expect(res.priority).toBe('noise')
  })

  it('nie taguje niepasującej wiadomości', () => {
    const res = applyRules(
      { from: 'a@b.pl', to: 'ja@x.pl', subject: 'Spotkanie jutro', body: '', headers: {} },
      [rule]
    )
    expect(res.tags).toEqual([])
    expect(res.priority).toBeNull()
  })
})
