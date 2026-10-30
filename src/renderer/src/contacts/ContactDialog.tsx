import { useState } from 'react'
import { initials, type ContactInit, type ContactService } from '@shared/contact'

interface Props {
  /** null = nowy kontakt */
  contact: ContactInit | null
  onSaved: (saved: ContactInit) => void
  onClose: () => void
}

export default function ContactDialog({ contact, onSaved, onClose }: Props): JSX.Element {
  const [photo, setPhoto] = useState<string | null>(contact?.photo ?? null)
  const [name, setName] = useState(contact?.name ?? '')
  const [email, setEmail] = useState(contact?.email ?? '')
  const [city, setCity] = useState(contact?.city ?? '')
  const [description, setDescription] = useState(contact?.description ?? '')
  const [services, setServices] = useState<ContactService[]>(contact?.services ?? [])
  const [error, setError] = useState<string | null>(null)

  const pickPhoto = async (): Promise<void> => {
    try {
      const picked = await window.api.pickContactPhoto()
      if (picked) setPhoto(picked)
    } catch (err) {
      setError(String(err).replace(/^.*Error: /, ''))
    }
  }

  const setService = (i: number, patch: Partial<ContactService>): void =>
    setServices((list) => list.map((s, j) => (j === i ? { ...s, ...patch } : s)))

  const save = async (): Promise<void> => {
    setError(null)
    try {
      onSaved(await window.api.saveContact({ id: contact?.id ?? null, photo, name, email, city, description, services }))
    } catch (err) {
      setError(String(err).replace(/^.*Error: /, ''))
    }
  }

  return (
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form
        className="modal contact-dialog"
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
        onKeyDown={(e) => e.key === 'Escape' && onClose()}
      >
        <h3>{contact ? 'Edytuj kontakt' : 'Nowy kontakt'}</h3>

        <div className="contact-photo-row">
          <Avatar photo={photo} name={name} size={64} />
          <button type="button" onClick={() => void pickPhoto()}>
            Wybierz zdjęcie
          </button>
          {photo && (
            <button type="button" onClick={() => setPhoto(null)}>
              Usuń zdjęcie
            </button>
          )}
        </div>

        <label>
          Imię i nazwisko lub nazwa firmy
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          Adres e-mail
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label>
          Miasto
          <input value={city} onChange={(e) => setCity(e.target.value)} />
        </label>
        <label>
          Krótki opis
          <textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>

        <div className="contact-services">
          <span>Serwisy</span>
          {services.map((s, i) => (
            <div key={i} className="contact-service-row">
              <input placeholder="Serwis" value={s.service} onChange={(e) => setService(i, { service: e.target.value })} />
              <input placeholder="Nazwa w serwisie" value={s.username} onChange={(e) => setService(i, { username: e.target.value })} />
              <button type="button" className="icon-btn" aria-label="Usuń serwis" onClick={() => setServices((l) => l.filter((_, j) => j !== i))}>
                ✕
              </button>
            </div>
          ))}
          <button type="button" onClick={() => setServices((l) => [...l, { service: '', username: '' }])}>
            + Dodaj serwis
          </button>
        </div>

        {error && <p className="error">{error}</p>}
        <div className="contact-actions">
          <button type="button" onClick={onClose}>
            Anuluj
          </button>
          <button type="submit" className="primary">
            Zapisz
          </button>
        </div>
      </form>
    </div>
  )
}

export function Avatar({ photo, name, size }: { photo: string | null; name: string; size: number }): JSX.Element {
  const style = { width: size, height: size, fontSize: size * 0.4 }
  return photo ? (
    <img className="avatar" src={photo} alt="" style={style} />
  ) : (
    <span className="avatar avatar-empty" style={style} aria-hidden>
      {initials(name) || '?'}
    </span>
  )
}
