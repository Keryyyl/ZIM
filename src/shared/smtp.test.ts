import { describe, expect, it } from 'vitest'
import { guessSmtp } from './smtp'

describe('guessSmtp', () => {
  it('zna popularnych dostawców', () => {
    expect(guessSmtp('imap.gmail.com')).toEqual({ host: 'smtp.gmail.com', port: 465 })
    expect(guessSmtp('IMAP.mail.me.com ')).toEqual({ host: 'smtp.mail.me.com', port: 587 })
  })
  it('dla nieznanych zamienia imap. na smtp.', () => {
    expect(guessSmtp('imap.firma.pl')).toEqual({ host: 'smtp.firma.pl', port: 465 })
    expect(guessSmtp('mail.firma.pl')).toEqual({ host: 'mail.firma.pl', port: 465 })
  })
})
