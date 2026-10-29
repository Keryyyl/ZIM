/** Serwery SMTP popularnych dostawców, po hoście IMAP (te same hasła aplikacji działają w obu). */
const KNOWN: Record<string, { host: string; port: number }> = {
  'imap.gmail.com': { host: 'smtp.gmail.com', port: 465 },
  'imap.mail.me.com': { host: 'smtp.mail.me.com', port: 587 },
  'imap.wp.pl': { host: 'smtp.wp.pl', port: 465 },
  'poczta.o2.pl': { host: 'poczta.o2.pl', port: 465 },
  'imap.poczta.onet.pl': { host: 'smtp.poczta.onet.pl', port: 465 },
  'poczta.interia.pl': { host: 'poczta.interia.pl', port: 465 },
  'imap.mail.yahoo.com': { host: 'smtp.mail.yahoo.com', port: 465 },
  'imap.fastmail.com': { host: 'smtp.fastmail.com', port: 465 },
  'outlook.office365.com': { host: 'smtp.office365.com', port: 587 }
}

/** Najlepsze przypuszczenie: znany dostawca, a w innym wypadku imap.x -> smtp.x na porcie 465 (TLS). */
export function guessSmtp(imapHost: string): { host: string; port: number } {
  const host = imapHost.trim().toLowerCase()
  return KNOWN[host] ?? { host: host.replace(/^imap\./, 'smtp.'), port: 465 }
}
