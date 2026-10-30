import { useEffect, useRef, useState, type MouseEvent } from 'react'
import SidebarToggle from './SidebarToggle'
import type { Account, MailboxView, MessageRow } from '@shared/types'

/** Nazwa skrzynki w UI: alias, a gdy go brak, adres e-mail */
export function accountLabel(a: Account): string {
  return a.alias || a.email
}

/** "Jan Kowalski <jan@x.pl>" -> "Jan Kowalski" */
function senderName(from: string): string {
  return from.replace(/\s*<[^>]*>.*$/, '') || from || '(brak nadawcy)'
}

const timeFmt = new Intl.DateTimeFormat('pl-PL', { hour: '2-digit', minute: '2-digit' })
const dayFmt = new Intl.DateTimeFormat('pl-PL', { day: 'numeric', month: 'short' })
const fullFmt = new Intl.DateTimeFormat('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric' })

function formatDate(ms: number): string {
  const d = new Date(ms)
  const now = new Date()
  if (d.toDateString() === now.toDateString()) return timeFmt.format(d)
  if (d.getFullYear() === now.getFullYear()) return dayFmt.format(d)
  return fullFmt.format(d)
}

const EMPTY_TEXT: Record<MailboxView, string> = {
  inbox: 'Brak wiadomości w tej skrzynce.',
  starred: 'Brak wiadomości oznaczonych gwiazdką.',
  archive: 'Archiwum jest puste.',
  spam: 'Brak spamu.',
  trash: 'Kosz jest pusty.'
}

/** 1 wiadomość, 2 wiadomości, 5 wiadomości */
function wiadomosci(n: number): string {
  return n === 1 ? 'wiadomość' : 'wiadomości'
}

interface Props {
  onToggleSidebar: () => void
  /** Komunikat pustej listy zamiast domyślnego dla folderu (np. widok tagu) */
  emptyText?: string
  title: string
  subtitle: string | null
  view: MailboxView
  messages: MessageRow[]
  accountsById: Map<number, Account>
  /** W "Wszystko" przy każdym mailu pokazujemy, z którego konta jest */
  showAccount: boolean
  hasAccounts: boolean
  accounts: Account[]
  /** null = "Wszystko" */
  inbox: number | null
  onSelectInbox: (id: number | null) => void
  /** Po każdej akcji lista jest pobierana od nowa */
  onChanged: () => void
  onOpen: (id: number) => void
  /** Wpisana fraza; wyniki (messages) obejmują wszystkie foldery */
  search: string
  /** Czy messages to już wyniki szukania */
  searchActive: boolean
  onSearch: (text: string) => void
}

export default function MessageList(props: Props): JSX.Element {
  const { onToggleSidebar, title, subtitle, view, messages, accountsById, showAccount, hasAccounts, accounts, inbox, onSelectInbox, onChanged, onOpen, search, searchActive, onSearch } = props
  const [selection, setSelection] = useState<Set<number>>(new Set())
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // ostatnio kliknięty checkbox, od niego liczy się zakres przy Shift+klik
  const anchor = useRef<number | null>(null)
  const selectAllRef = useRef<HTMLInputElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const [searchOpen, setSearchOpen] = useState(search !== '')

  // po synchronizacji lub akcji część zaznaczonych wiadomości mogła zniknąć z listy
  const visibleIds = new Set(messages.map((m) => m.id))
  const selected = messages.filter((m) => selection.has(m.id))
  const selectedIds = selected.map((m) => m.id)
  const allSelected = messages.length > 0 && selected.length === messages.length
  const someSelected = selected.length > 0 && !allSelected

  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = someSelected
  }, [someSelected])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setSelection(new Set())
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const toggleOne = (index: number, e: MouseEvent<HTMLInputElement>): void => {
    const id = messages[index].id
    const checked = !selection.has(id)
    const next = new Set([...selection].filter((x) => visibleIds.has(x)))
    const from = anchor.current !== null && e.shiftKey ? anchor.current : index
    const [start, end] = from < index ? [from, index] : [index, from]
    for (let i = start; i <= end; i++) {
      if (checked) next.add(messages[i].id)
      else next.delete(messages[i].id)
    }
    anchor.current = index
    setSelection(next)
  }

  const toggleAll = (): void => {
    anchor.current = null
    setSelection(allSelected ? new Set() : new Set(messages.map((m) => m.id)))
  }

  const run = async (action: () => Promise<unknown>, message?: string): Promise<void> => {
    setBusy(true)
    setNotice(null)
    try {
      await action()
      setSelection(new Set())
      if (message) setNotice(message)
    } catch (err) {
      setNotice(`Nie udało się: ${String(err).replace(/^.*Error: /, '')}`)
    } finally {
      setBusy(false)
      onChanged()
    }
  }

  const n = selectedIds.length
  const count = `${n} ${wiadomosci(n)}`
  const allStarred = selected.length > 0 && selected.every((m) => m.starred)
  const allRead = selected.length > 0 && selected.every((m) => m.read)

  const toggleRead = (): Promise<void> => run(() => window.api.markRead(selectedIds, !allRead))
  const star = (): Promise<void> =>
    run(() => window.api.starMessages(selectedIds, !allStarred))
  const archive = (): Promise<void> =>
    run(() => window.api.moveMessages(selectedIds, 'archive'), `Zarchiwizowano: ${count}`)
  const toInbox = (): Promise<void> =>
    run(() => window.api.moveMessages(selectedIds, 'inbox'), `Przeniesiono do odebranych: ${count}`)
  const trash = (): Promise<void> =>
    run(() => window.api.moveMessages(selectedIds, 'trash'), `Przeniesiono do kosza: ${count}`)
  const spam = (): Promise<void> =>
    run(async () => {
      const blocked = await window.api.markSpam(selectedIds)
      setNotice(
        blocked > 0
          ? `Zablokowano nadawców: ${blocked}. Wszystkie ich wiadomości, także przyszłe, trafiają do spamu.`
          : `Przeniesiono do spamu: ${count}`
      )
    })
  const notSpam = (): Promise<void> =>
    run(() => window.api.markNotSpam(selectedIds), 'Odblokowano nadawców, ich wiadomości wróciły do odebranych.')
  const destroy = (): Promise<void> => {
    if (!window.confirm(`Usunąć na zawsze ${count}? Tej operacji nie można cofnąć.`)) return Promise.resolve()
    return run(() => window.api.deleteForever(selectedIds), `Usunięto na zawsze: ${count}`)
  }


  return (
    <main className={`list ${n > 0 ? 'selecting' : ''}`}>
      <header className="list-header">
        <div className="list-title">
          <SidebarToggle onToggle={onToggleSidebar} />
          <h2>{searchActive ? 'Wyniki wyszukiwania' : title}</h2>
          {hasAccounts && messages.length > 0 && <span className="count">{messages.length}</span>}
          {subtitle && !searchActive && <span className="muted">{subtitle}</span>}
          {searchOpen ? (
            <div className="search">
              <input
                ref={searchRef}
                autoFocus
                type="search"
                value={search}
                placeholder="Szukaj w temacie, nadawcy i treści…"
                onChange={(e) => onSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== 'Escape') return
                  e.stopPropagation()
                  onSearch('')
                  setSearchOpen(false)
                }}
                aria-label="Szukaj wiadomości"
              />
              <button
                className="icon-btn"
                onClick={() => {
                  onSearch('')
                  setSearchOpen(false)
                }}
                aria-label="Zamknij wyszukiwanie"
                title="Zamknij (Esc)"
              >
                ✕
              </button>
            </div>
          ) : (
            <button className="icon-btn search-btn" onClick={() => setSearchOpen(true)} aria-label="Szukaj" title="Szukaj">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.5-3.5" />
              </svg>
            </button>
          )}
        </div>
        {accounts.length > 1 && (
          <div className="tabs" role="tablist">
            <button role="tab" aria-selected={inbox === null} className={inbox === null ? 'active' : ''} onClick={() => onSelectInbox(null)}>
              Wszystko
            </button>
            {accounts.map((a) => (
              <button
                key={a.id}
                role="tab"
                aria-selected={inbox === a.id}
                className={inbox === a.id ? 'active' : ''}
                onClick={() => onSelectInbox(a.id)}
                title={a.email}
              >
                {accountLabel(a)}
              </button>
            ))}
          </div>
        )}
        <div className="toolbar">
          {n > 0 ? (
            <>
              <input
                ref={selectAllRef}
                type="checkbox"
                className="check"
                checked={allSelected}
                disabled={messages.length === 0}
                onChange={toggleAll}
                aria-label={allSelected ? 'Odznacz wszystkie' : 'Zaznacz wszystkie'}
                title={allSelected ? 'Odznacz wszystkie' : 'Zaznacz wszystkie'}
              />
              <span className="selected-count">Zaznaczono: {n}</span>
              <div className="actions">
                <button className="btn" disabled={busy} onClick={toggleRead}>
                  {allRead ? 'Oznacz jako nieprzeczytane' : 'Oznacz jako przeczytane'}
                </button>
                {view !== 'spam' && view !== 'trash' && (
                  <button className="btn" disabled={busy} onClick={star}>
                    {allStarred ? '☆ Usuń gwiazdkę' : '★ Oznacz gwiazdką'}
                  </button>
                )}
                {(view === 'inbox' || view === 'starred') && (
                  <button className="btn" disabled={busy} onClick={archive}>
                    Archiwizuj
                  </button>
                )}
                {(view === 'archive' || view === 'trash') && (
                  <button className="btn" disabled={busy} onClick={toInbox}>
                    Przenieś do odebranych
                  </button>
                )}
                {view === 'spam' ? (
                  <button className="btn" disabled={busy} onClick={notSpam}>
                    To nie spam
                  </button>
                ) : (
                  view !== 'trash' && (
                    <button
                      className="btn"
                      disabled={busy}
                      onClick={spam}
                      title="Przenosi do spamu wszystkie wiadomości od tych nadawców, także przyszłe"
                    >
                      Zgłoś spam
                    </button>
                  )
                )}
                {view === 'trash' ? (
                  <button className="btn danger" disabled={busy} onClick={destroy}>
                    Usuń na zawsze
                  </button>
                ) : (
                  <button className="btn danger" disabled={busy} onClick={trash}>
                    Usuń
                  </button>
                )}
              </div>
            </>
          ) : (
            notice && <span className="notice">{notice}</span>
          )}
        </div>
      </header>
      {!hasAccounts ? (
        <p className="empty">Brak wiadomości. Dodaj konto w ustawieniach (ikona zębatki w lewym dolnym rogu).</p>
      ) : messages.length === 0 ? (
        <p className="empty">{searchActive ? `Nic nie znaleziono dla „${search.trim()}”.` : props.emptyText ?? EMPTY_TEXT[view]}</p>
      ) : (
        messages.map((m, i) => {
          const account = accountsById.get(m.accountId)
          return (
            <div
              key={m.id}
              className={`row ${m.read ? '' : 'unread'} ${selection.has(m.id) ? 'selected' : ''}`}
              role="button"
              tabIndex={0}
              onClick={() => onOpen(m.id)}
              onKeyDown={(e) => e.key === 'Enter' && e.target === e.currentTarget && onOpen(m.id)}
            >
              <input
                type="checkbox"
                className="check"
                checked={selection.has(m.id)}
                onClick={(e) => {
                  e.stopPropagation() // zaznaczenie nie otwiera wiadomości
                  toggleOne(i, e)
                }}
                onChange={() => undefined /* obsługa w onClick, bo potrzebny jest shiftKey */}
                aria-label={`Zaznacz: ${m.subject || '(bez tematu)'}`}
              />
              <span
                className="row-tag-dot"
                style={m.tags[0]?.color ? ({ '--tag': m.tags[0].color } as React.CSSProperties) : undefined}
                title={m.tags[0]?.name}
              />
              <span className="from" title={m.from}>
                {senderName(m.from)}
              </span>
              {showAccount && account && (
                <span className="account-badge" title={account.email}>
                  {accountLabel(account)}
                </span>
              )}
              <span className="preview">
                <span className="subject">{m.subject || '(bez tematu)'}</span>
                {m.snippet && <span className="snippet"> – {m.snippet}</span>}
              </span>
              {m.hasAttachments && (
                <span className="clip" role="img" aria-label="Ma załączniki" title="Ma załączniki">
                  📎
                </span>
              )}
              <time className="date">{formatDate(m.date)}</time>
            </div>
          )
        })
      )}
    </main>
  )
}
