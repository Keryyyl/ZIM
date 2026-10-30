import { useCallback, useEffect, useState } from 'react'
import type { ContactInit } from '@shared/contact'
import { GearIcon, HistoryIcon, MailIcon } from '../HeaderButtons'
import ContactCard from './ContactCard'
import ContactDialog, { Avatar } from './ContactDialog'

/** Panel kontaktów w prawym pasku bocznym. */
interface Props {
  canCompose: boolean
  /** Zaczyna nową wiadomość do tego adresu */
  onCompose: (email: string) => void
  /** Pokazuje w skrzynce całą korespondencję z tym adresem */
  onHistory: (email: string, name: string) => void
  /** Otwiera wiadomość w czytniku */
  onOpenMessage: (id: number) => void
}

export default function ContactsScreen({ canCompose, onCompose, onHistory, onOpenMessage }: Props): JSX.Element {
  const [contacts, setContacts] = useState<ContactInit[]>([])
  // undefined = dialog zamknięty, null = nowy kontakt, obiekt = edycja
  const [dialog, setDialog] = useState<ContactInit | null | undefined>(undefined)
  // po naciśnięciu "x" następny wybrany kontakt zostaje usunięty
  const [shown, setShown] = useState<ContactInit | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback((): void => void window.api.listContacts().then(setContacts), [])
  useEffect(load, [load])

  useEffect(() => {
    if (!deleting) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setDeleting(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [deleting])

  const remove = async (c: ContactInit): Promise<void> => {
    setDeleting(false)
    try {
      await window.api.deleteContact(c.id as number)
      load()
    } catch (err) {
      setError(String(err).replace(/^.*Error: /, ''))
    }
  }

  return (
    <div className={`contacts ${deleting ? 'deleting' : ''}`}>
      {shown ? (
        <>
          <ContactCard contact={shown} onClose={() => setShown(null)} onOpenMessage={onOpenMessage} />
          <footer className="contacts-footer">
            <span className="contacts-brand">ZIM</span>
            <button
              className="icon-btn"
              disabled={!canCompose}
              aria-label="Wyślij wiadomość"
              title={canCompose ? 'Wyślij wiadomość' : 'Najpierw dodaj konto w ustawieniach'}
              onClick={() => onCompose(shown.email)}
            >
              <MailIcon />
            </button>
            <button
              className="icon-btn"
              aria-label="Historia wiadomości"
              title="Historia wiadomości"
              onClick={() => onHistory(shown.email, shown.name)}
            >
              <HistoryIcon />
            </button>
            <button className="icon-btn" aria-label="Ustawienia kontaktu" title="Ustawienia kontaktu" onClick={() => setDialog(shown)}>
              <GearIcon size={18} />
            </button>
          </footer>
        </>
      ) : (
        <>
        <h2 className="contacts-title">Kontakty</h2>

        <ul className="contact-list">
          {contacts.map((c) => (
            <li key={c.id} className="contact-row" onClick={() => (deleting ? void remove(c) : setShown(c))}>
              <Avatar photo={c.photo ?? null} name={c.name} size={36} />
              <span className="contact-name">{c.name}</span>
              <button
                className="icon-btn contact-edit"
                aria-label={`Edytuj kontakt ${c.name}`}
                title="Edytuj kontakt"
                onClick={(e) => {
                  e.stopPropagation()
                  if (deleting) void remove(c)
                  else {
                    setShown(null)
                    setDialog(c)
                  }
                }}
              >
                <GearIcon size={16} />
              </button>
            </li>
          ))}
          {contacts.length === 0 && <li className="empty">Brak kontaktów. Dodaj pierwszy przyciskiem +.</li>}
        </ul>
        {error && <p className="error contacts-error">{error}</p>}

        <footer className="contacts-footer">
          <span className="contacts-brand">ZIM</span>
          <button className="icon-btn" onClick={() => setDialog(null)} aria-label="Dodaj kontakt" title="Dodaj kontakt">
            +
          </button>
          <button
            className={`icon-btn ${deleting ? 'active' : ''}`}
            onClick={() => setDeleting((d) => !d)}
            aria-pressed={deleting}
            aria-label="Usuń kontakt"
            title={deleting ? 'Kliknij kontakt, który ma zostać usunięty (Esc anuluje)' : 'Usuń kontakt'}
          >
            ×
          </button>
        </footer>
        </>
      )}
      {dialog !== undefined && (
        <ContactDialog
          contact={dialog}
          onClose={() => setDialog(undefined)}
          onSaved={(saved) => {
            setDialog(undefined)
            setShown((cur) => (cur && cur.id === saved.id ? saved : cur))
            load()
          }}
        />
      )}
    </div>
  )
}
