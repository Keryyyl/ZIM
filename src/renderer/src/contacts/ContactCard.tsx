import { useEffect, useState } from 'react'
import { serviceUrl, type ContactInit, type ContactMail } from '@shared/contact'
import { Avatar } from './ContactDialog'

/** DD MM YY, np. "30 10 26" */
function formatDate(ms: number): string {
  const d = new Date(ms)
  const two = (n: number): string => String(n).padStart(2, '0')
  return `${two(d.getDate())} ${two(d.getMonth() + 1)} ${two(d.getFullYear() % 100)}`
}

/** Ekran kontaktu w prawym pasku (podmienia listę): dane, ostatnie 3 maile w obie strony i linki do serwisów. */
/** `onCompose` brak = nie ma jeszcze konta, z którego można wysłać; adres jest wtedy zwykłym tekstem */
export default function ContactCard({
  contact,
  onClose,
  onOpenMessage,
  onCompose
}: {
  contact: ContactInit
  onClose: () => void
  onOpenMessage: (id: number) => void
  onCompose?: () => void
}): JSX.Element {
  const [mail, setMail] = useState<ContactMail[] | null>(null)

  useEffect(() => {
    let current = true
    if (contact.id != null) void window.api.contactMail(contact.id).then((m) => current && setMail(m))
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      current = false
      window.removeEventListener('keydown', onKey)
    }
  }, [contact.id, onClose])

  return (
    <div className="contact-card" aria-label={contact.name}>
        <header className="contact-card-head">
          <h3>{contact.name}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Wróć do kontaktów" title="Wróć do kontaktów (Esc)">
            ✕
          </button>
        </header>

        <div className="contact-card-id">
          <Avatar photo={contact.photo ?? null} name={contact.name} size={72} />
          <div>
            {onCompose ? (
              <button className="contact-email" onClick={onCompose} title="Napisz wiadomość">
                {contact.email}
              </button>
            ) : (
              <span>{contact.email}</span>
            )}
            {contact.city && <div className="muted">{contact.city}</div>}
          </div>
        </div>

        {contact.description && <p className="contact-card-desc">{contact.description}</p>}

        <section className="contact-card-mail">
          <h4>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor"
              strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <rect x="3" y="5" width="18" height="14" rx="2" />
              <path d="m3 7 9 6 9-6" />
            </svg>
            Mail
          </h4>
          {mail === null ? null : mail.length === 0 ? (
            <p className="muted">Brak wiadomości.</p>
          ) : (
            <ul>
              {mail.map((m) => (
                <li key={m.id}>
                  <button className="mail-item" onClick={() => onOpenMessage(m.id)}>
                    <span className="mail-dir" title={m.direction === 'sent' ? 'Wysłana do kontaktu' : 'Otrzymana od kontaktu'}>
                      {m.direction === 'sent' ? '↗' : '↙'}
                    </span>
                    <span className="mail-subject">{m.subject || '(bez tematu)'}</span>
                    <time>{formatDate(m.date)}</time>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {(contact.services ?? []).length > 0 && (
          <section className="contact-card-links">
            {(contact.services ?? []).map((s, i) => {
              const url = serviceUrl(s)
              return url ? (
                <a key={i} href={url} target="_blank" rel="noreferrer" title={url}>
                  {s.service}: {s.username}
                </a>
              ) : (
                <span key={i}>
                  {s.service}: {s.username}
                </span>
              )
            })}
          </section>
        )}
    </div>
  )
}
