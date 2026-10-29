import { useEffect, useMemo, useRef, useState } from 'react'
import type { Account, MessageDetail } from '@shared/types'
import Attachments from './Attachments'
import { sanitizeEmailHtml } from './sanitize'

const fullDateFmt = new Intl.DateTimeFormat('pl-PL', { dateStyle: 'full', timeStyle: 'short' })

/** "Jan Kowalski <jan@x.pl>" -> { name: "Jan Kowalski", address: "jan@x.pl" } */
function splitAddress(value: string): { name: string; address: string | null } {
  const match = value.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/)
  if (match && match[1]) return { name: match[1], address: match[2] }
  return { name: match ? match[2] : value, address: null }
}

interface Props {
  id: number
  accountsById: Map<number, Account>
  onClose: () => void
  /** Otwarcie oznacza wiadomość jako przeczytaną; lista musi się odświeżyć */
  onChanged: () => void
}

export default function Reader({ id, accountsById, onClose, onChanged }: Props): JSX.Element {
  const [message, setMessage] = useState<MessageDetail | null | undefined>(undefined)
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    let current = true
    window.api.getMessage(id).then((m) => {
      if (!current) return
      setMessage(m)
      // tak jak w Gmailu: otwarcie = przeczytane, także na serwerze (przy synchronizacji)
      if (m && !m.read) void window.api.markRead([m.id], true).then(onChanged)
    })
    return () => {
      current = false
    }
  }, [id])

  useEffect(() => {
    closeRef.current?.focus()
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const html = useMemo(() => (message?.bodyHtml ? sanitizeEmailHtml(message.bodyHtml) : null), [message])
  const from = message ? splitAddress(message.from) : null
  const account = message ? accountsById.get(message.accountId) : undefined

  return (
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <article className="modal reader" role="dialog" aria-modal="true" aria-labelledby="reader-subject">
        <button ref={closeRef} className="icon-btn modal-close" onClick={onClose} aria-label="Zamknij" title="Zamknij (Esc)">
          ✕
        </button>
        {message === undefined ? (
          <p className="empty">Wczytywanie…</p>
        ) : message === null ? (
          <p className="empty">Tej wiadomości już nie ma (mogła zostać usunięta na serwerze).</p>
        ) : (
          <>
            <header className="reader-header">
              <h2 id="reader-subject">{message.subject || '(bez tematu)'}</h2>
              <dl className="reader-meta">
                <dt>Od</dt>
                <dd>
                  <strong>{from!.name || '(brak nadawcy)'}</strong>
                  {from!.address && <span className="muted"> &lt;{from!.address}&gt;</span>}
                </dd>
                <dt>Do</dt>
                <dd className="reader-to">{message.to || '(brak adresatów)'}</dd>
                <dt>Data</dt>
                <dd>
                  {fullDateFmt.format(new Date(message.date))}
                  {account && (
                    <span className="account-badge" title={account.email}>
                      {account.alias || account.email}
                    </span>
                  )}
                </dd>
              </dl>
              {html && html.blockedImages > 0 && (
                <p className="reader-notice">
                  Zablokowano zdalne obrazki ({html.blockedImages}), żeby nadawca nie wiedział, że otworzono wiadomość.
                </p>
              )}
              <Attachments key={message.id} attachments={message.attachments} />
            </header>
            <div className="reader-body">
              {html ? (
                <iframe
                  title="Treść wiadomości"
                  // bez allow-scripts i allow-same-origin: treść maila nie ma dostępu do aplikacji;
                  // allow-popups tylko po to, żeby linki otwierały się w przeglądarce
                  sandbox="allow-popups allow-popups-to-escape-sandbox"
                  srcDoc={html.document}
                />
              ) : (
                <pre className="reader-text">{message.bodyText || '(pusta wiadomość)'}</pre>
              )}
            </div>
          </>
        )}
      </article>
    </div>
  )
}
