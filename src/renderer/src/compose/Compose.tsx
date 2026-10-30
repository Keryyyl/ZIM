import { useEffect, useRef, useState } from 'react'
import type { Account, PickedFile } from '@shared/types'
import RecipientInput, { isEmail, parseAddresses } from './RecipientInput'

/** Ten sam limit co w procesie głównym (mail/send.ts) */
const MAX_ATTACHMENTS_BYTES = 25 * 1024 * 1024

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB`
}

/** Wartość dla <input type="datetime-local"> w czasie lokalnym */
function toLocalInput(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function tomorrowMorning(): Date {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  d.setHours(8, 0, 0, 0)
  return d
}

const scheduleFmt = new Intl.DateTimeFormat('pl-PL', { dateStyle: 'full', timeStyle: 'short' })

interface Props {
  accounts: Account[]
  /** Konto wybrane w panelu bocznym; domyślny nadawca */
  defaultAccountId: number | null
  onClose: () => void
  /** Po wysłaniu/zaplanowaniu: komunikat do pokazania w aplikacji */
  onDone: (message: string) => void
  /** Odpowiedź: gotowy nadawca, adresat i temat */
  initial?: { accountId: number; to: string; subject: string }
}

export default function Compose({ accounts, defaultAccountId, onClose, onDone, initial }: Props): JSX.Element {
  const [accountId, setAccountId] = useState<number>(initial?.accountId ?? defaultAccountId ?? accounts[0]?.id ?? -1)
  const [to, setTo] = useState<string[]>(initial ? [initial.to] : [])
  const [toText, setToText] = useState('')
  const [subject, setSubject] = useState(initial?.subject ?? '')
  const [text, setText] = useState('')
  const [files, setFiles] = useState<PickedFile[]>([])
  const [busy, setBusy] = useState<false | 'send' | 'schedule' | 'files'>(false)
  const [error, setError] = useState<string | null>(null)
  const [scheduleOpen, setScheduleOpen] = useState(false)
  const [sendAt, setSendAt] = useState(() => toLocalInput(tomorrowMorning()))
  const firstFieldRef = useRef<HTMLSelectElement>(null)

  const totalSize = files.reduce((n, f) => n + f.size, 0)
  const dirty = to.length > 0 || toText.trim() !== '' || subject !== '' || text !== '' || files.length > 0

  // zamknięcie okna z wpisaną treścią: pytamy, żeby przypadkowy klik w tło jej nie skasował
  const requestClose = (): void => {
    if (busy === 'send' || busy === 'schedule') return
    if (!dirty || window.confirm('Odrzucić tę wiadomość?')) onClose()
  }
  const requestCloseRef = useRef(requestClose)
  requestCloseRef.current = requestClose
  const scheduleOpenRef = useRef(scheduleOpen)
  scheduleOpenRef.current = scheduleOpen

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        if (scheduleOpenRef.current) setScheduleOpen(false)
        else requestCloseRef.current()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  useEffect(() => {
    // bez konta z panelu wybieramy nadawcę na początku, inaczej od razu adresatów
    if (defaultAccountId === null && accounts.length > 1) firstFieldRef.current?.focus()
    else document.getElementById('compose-to')?.focus()
  }, [])

  /** Adresaci łącznie z wpisanym, niezatwierdzonym tekstem */
  const recipients = (): string[] => {
    const all = [...to]
    for (const a of parseAddresses(toText)) if (!all.includes(a)) all.push(a)
    return all
  }

  const check = (): string[] | null => {
    const list = recipients()
    setTo(list)
    setToText('')
    if (list.length === 0) return fail('Dodaj co najmniej jednego adresata')
    const invalid = list.filter((a) => !isEmail(a))
    if (invalid.length > 0) return fail(`Popraw adres: ${invalid.join(', ')}`)
    if (totalSize > MAX_ATTACHMENTS_BYTES) return fail('Załączniki mogą mieć razem najwyżej 25 MB')
    if (!subject.trim() && !window.confirm('Wysłać wiadomość bez tematu?')) return null
    return list
  }
  const fail = (message: string): null => {
    setError(message)
    return null
  }

  const draft = (list: string[]): Parameters<typeof window.api.sendMail>[0] => ({
    accountId,
    to: list,
    subject,
    text,
    attachments: files.map((f) => f.token)
  })

  const send = async (): Promise<void> => {
    if (busy) return
    setError(null)
    const list = check()
    if (!list) return
    setBusy('send')
    try {
      await window.api.sendMail(draft(list))
      onDone(`Wysłano do: ${list.join(', ')}`)
      onClose()
    } catch (err) {
      setError(`Nie udało się wysłać: ${String(err).replace(/^.*Error: /, '')}`)
      setBusy(false)
    }
  }

  const schedule = async (): Promise<void> => {
    if (busy) return
    setError(null)
    const when = new Date(sendAt)
    if (Number.isNaN(when.getTime())) return void fail('Wybierz datę i godzinę')
    if (when.getTime() <= Date.now()) return void fail('Wybierz godzinę w przyszłości')
    const list = check()
    if (!list) return
    setBusy('schedule')
    try {
      await window.api.scheduleMail(draft(list), when.getTime())
      onDone(`Zaplanowano na ${scheduleFmt.format(when)}`)
      onClose()
    } catch (err) {
      setError(`Nie udało się zaplanować: ${String(err).replace(/^.*Error: /, '')}`)
      setBusy(false)
    }
  }

  const addFiles = async (): Promise<void> => {
    setBusy('files')
    try {
      const picked = await window.api.pickFiles()
      setFiles((f) => [...f, ...picked])
    } finally {
      setBusy(false)
    }
  }

  const account = accounts.find((a) => a.id === accountId)

  return (
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && requestClose()}>
      <form
        className="modal compose"
        role="dialog"
        aria-modal="true"
        aria-labelledby="compose-title"
        // Enter w polu (np. w temacie) nie może wysłać maila; wysyła tylko przycisk lub Cmd/Ctrl+Enter
        onSubmit={(e) => e.preventDefault()}
        onKeyDown={(e) => {
          // Cmd/Ctrl+Enter wysyła, jak w Gmailu
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault()
            void send()
          }
        }}
      >
        <button type="button" className="icon-btn modal-close" onClick={requestClose} aria-label="Zamknij" title="Zamknij (Esc)">
          ✕
        </button>
        <header className="compose-header">
          <h2 id="compose-title">Nowa wiadomość</h2>
        </header>

        <div className="compose-fields">
          <label htmlFor="compose-from">Mail, z którego wysyłasz</label>
          <select
            id="compose-from"
            ref={firstFieldRef}
            value={accountId}
            onChange={(e) => setAccountId(Number(e.target.value))}
          >
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.alias ? `${a.alias} (${a.email})` : a.email}
              </option>
            ))}
          </select>

          <label htmlFor="compose-to">Adresaci</label>
          <RecipientInput id="compose-to" value={to} onChange={setTo} text={toText} onTextChange={setToText} />

          <label htmlFor="compose-subject">Temat</label>
          <input id="compose-subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
        </div>

        <textarea
          className="compose-body"
          aria-label="Treść wiadomości"
          placeholder="Treść wiadomości…"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />

        {files.length > 0 && (
          <ul className="attachments">
            {files.map((f) => (
              <li key={f.token} className="chip" title={f.name}>
                <span className="attachment-name">{f.name}</span>
                <span className="muted">{formatSize(f.size)}</span>
                <button
                  type="button"
                  className="chip-remove"
                  onClick={() => setFiles((list) => list.filter((x) => x.token !== f.token))}
                  aria-label={`Usuń załącznik ${f.name}`}
                >
                  ×
                </button>
              </li>
            ))}
            <li className={`attachments-total ${totalSize > MAX_ATTACHMENTS_BYTES ? 'error' : 'muted'}`}>
              Razem {formatSize(totalSize)} / 25 MB
            </li>
          </ul>
        )}

        <footer className="compose-footer">
          <button type="button" className="btn" onClick={addFiles} disabled={!!busy}>
            📎 Dodaj pliki
          </button>
          {error && (
            <p className="error compose-error" role="alert">
              {error}
            </p>
          )}
          <div className="compose-send">
            <div className="schedule-wrap">
              <button
                type="button"
                className={`btn ${scheduleOpen ? 'active' : ''}`}
                onClick={() => setScheduleOpen((o) => !o)}
                disabled={!!busy}
                aria-expanded={scheduleOpen}
              >
                🕒 Wyślij o…
              </button>
              {scheduleOpen && (
                <div className="schedule-popover" role="dialog" aria-label="Zaplanuj wysyłkę">
                  <label htmlFor="compose-send-at">Data i godzina wysyłki</label>
                  <input
                    id="compose-send-at"
                    type="datetime-local"
                    value={sendAt}
                    min={toLocalInput(new Date())}
                    onChange={(e) => setSendAt(e.target.value)}
                  />
                  <p className="muted hint">
                    Wiadomość wyśle ZIM z konta {account?.email}. Aplikacja musi być wtedy włączona; jeśli nie
                    będzie, wiadomość wyjdzie zaraz po jej uruchomieniu.
                  </p>
                  <button type="button" className="btn primary" onClick={schedule} disabled={!!busy}>
                    {busy === 'schedule' ? 'Planowanie…' : 'Zaplanuj'}
                  </button>
                </div>
              )}
            </div>
            <button type="button" className="btn primary" onClick={send} disabled={!!busy} title="Wyślij (⌘/Ctrl+Enter)">
              {busy === 'send' ? 'Wysyłanie…' : 'Wyślij'}
            </button>
          </div>
        </footer>
      </form>
    </div>
  )
}
