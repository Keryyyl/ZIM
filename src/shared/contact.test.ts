import { describe, expect, it } from 'vitest'
import { Contact, initials, serviceUrl } from './contact'

describe('Contact', () => {
  it('normalizuje dane i ustawia wartości domyślne', () => {
    const c = new Contact({ name: '  Jan Kowalski ', email: ' Jan@Example.PL ' })
    expect(c.name).toBe('Jan Kowalski')
    expect(c.email).toBe('jan@example.pl')
    expect(c.photo).toBeNull()
    expect(c.city).toBe('')
    expect(c.services).toEqual([])
  })

  it('odrzuca pustą nazwę i zły e-mail', () => {
    expect(() => new Contact({ name: ' ', email: 'a@b.pl' })).toThrow()
    expect(() => new Contact({ name: 'Firma', email: 'brak-małpy' })).toThrow()
  })

  it('dodaje i usuwa serwisy bez duplikatów', () => {
    const c = new Contact({ name: 'ACME sp. z o.o.', email: 'biuro@acme.pl' })
    c.addService('LinkedIn', 'acme')
    c.addService('linkedin', 'acme')
    c.addService('GitHub', 'acme-dev')
    expect(c.services).toEqual([
      { service: 'LinkedIn', username: 'acme' },
      { service: 'GitHub', username: 'acme-dev' }
    ])
    c.removeService('LINKEDIN', 'acme')
    expect(c.services).toEqual([{ service: 'GitHub', username: 'acme-dev' }])
    expect(() => c.addService('', 'x')).toThrow()
  })
})

describe('initials i serviceUrl', () => {
  it('daje 1 albo 2 litery', () => {
    expect(initials('Jan Kowalski')).toBe('JK')
    expect(initials('  anna maria nowak ')).toBe('AM')
    expect(initials('ACME')).toBe('A')
    expect(initials('')).toBe('')
  })

  it('buduje linki tylko dla znanych serwisów', () => {
    expect(serviceUrl({ service: 'GitHub', username: '@jan' })).toBe('https://github.com/jan')
    expect(serviceUrl({ service: 'Nieznany', username: 'x' })).toBeNull()
    expect(serviceUrl({ service: 'WWW', username: 'https://acme.pl' })).toBe('https://acme.pl')
    expect(serviceUrl({ service: 'github', username: 'a/b?c' })).toBe('https://github.com/a%2Fb%3Fc')
  })
})
