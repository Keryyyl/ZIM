import { useEffect, useMemo, useRef, useState } from 'react'
import type { Account, MessageDetail, Tag } from '@shared/types'
import TagChip from '../TagChip'
import Attachments from './Attachments'
import Summary from './Summary'
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
  const [allTags, setAllTags] = useState<Tag[]>([])
  const [picking, setPicking] = useState(false)
  const tagAddRef = useRef<HTMLSpanElement>(null)

  // klik gdziekolwiek poza przyciskiem „+ Tag” i jego listą zamyka listę
  useEffect(() => {
    if (!picking) return
    const onDown = (e: MouseEvent): void => {
      if (!tagAddRef.current?.contains(e.target as Node)) setPicking(false)
    }
    // treść maila jest w iframe, kliknięcia w nią nie docierają do dokumentu, ale zabierają mu fokus
    const onBlur = (): void => setPicking(false)
    document.addEventListener('mousedown', onDown)
    window.addEventListener('blur', onBlur)
    return () => {
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('blur', onBlur)
    }
  }, [picking])
  const [tagging, setTagging] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)

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
    void window.api.listTags().then(setAllTags)
  }, [])

  const toggleTag = async (tag: Tag, on: boolean): Promise<void> => {
    if (!message) return
    await window.api.tagMessages([message.id], tag.id, on)
    const tags = on
      ? [...message.tags, tag].sort((a, b) => a.name.localeCompare(b.name, 'pl'))
      : message.tags.filter((t) => t.id !== tag.id)
    setMessage({ ...message, tags })
    onChanged()
  }

  const suggestTags = async (): Promise<void> => {
    if (!message) return
    setTagging(true)
    setAiError(null)
    try {
      const updated = await window.api.reclassifyMessage(message.id)
      if (updated) setMessage(updated)
      onChanged()
    } catch (err) {
      setAiError(String(err).replace(/^.*Error: /, ''))
    } finally {
      setTagging(false)
    }
  }

  useEffect(() => {
    closeRef.current?.focus()
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      // pierwszy Esc zamyka listę tagów, dopiero drugi czytnik
      if (picking) setPicking(false)
      else onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, picking])

  // color-scheme na <html> ustawia motyw aplikacji (ręczny wybór albo systemowy)
  const dark = getComputedStyle(document.documentElement).colorScheme === 'dark'
  const html = useMemo(() => (message?.bodyHtml ? sanitizeEmailHtml(message.bodyHtml, dark) : null), [message, dark])
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
              <div className="reader-tags">
                {message.tags.map((t) => (
                  <TagChip key={t.id} tag={t} onRemove={() => void toggleTag(t, false)} />
                ))}
                <span className="tag-add" ref={tagAddRef}>
                  <button className="tag-action" onClick={() => setPicking((p) => !p)} aria-expanded={picking}>
                    + Tag
                  </button>
                  {picking && (
                    <div className="tag-menu" role="menu">
                      {allTags.length === 0 ? (
                        <p className="muted">Brak tagów. Utwórz je w Ustawieniach → Tagi.</p>
                      ) : (
                        allTags
                          .filter((t) => !message.tags.some((m) => m.id === t.id))
                          .map((t) => (
                            <button
                              key={t.id}
                              role="menuitem"
                              onClick={() => {
                                setPicking(false)
                                void toggleTag(t, true)
                              }}
                            >
                              <TagChip tag={t} />
                            </button>
                          ))
                      )}
                      {allTags.length > 0 && allTags.every((t) => message.tags.some((m) => m.id === t.id)) && (
                        <p className="muted">Wszystkie tagi są już dodane.</p>
                      )}
                    </div>
                  )}
                </span>
                <button
                  className="tag-action ai"
                  onClick={() => void suggestTags()}
                  disabled={tagging}
                  aria-busy={tagging}
                  title="Asystent AI dobierze tagi do tej wiadomości (zastąpi swoje wcześniejsze, ręcznych nie rusza)"
                >
                  {tagging ? (
                    <span className="spinner" aria-hidden />
                  ) : (
                    <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" aria-hidden>
                      <path d="M12 2.5l1.9 5.6 5.6 1.9-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.9z" />
                      <path d="M19 15l.8 2.2 2.2.8-2.2.8L19 21l-.8-2.2-2.2-.8 2.2-.8z" />
                    </svg>
                  )}
                  {tagging ? 'Taguję…' : 'Tagi AI'}
                </button>
              </div>
              {aiError && (
                <p className="error" role="alert">
                  {aiError}
                </p>
              )}
              {html && html.blockedImages > 0 && (
                <p className="reader-notice">
                  Zablokowano zdalne obrazki ({html.blockedImages}), żeby nadawca nie wiedział, że otworzono wiadomość.
                </p>
              )}
              <Attachments key={message.id} attachments={message.attachments} />
            </header>
            <Summary key={message.id} message={message} />
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
