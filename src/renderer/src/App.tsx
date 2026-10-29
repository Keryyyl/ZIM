import { useCallback, useEffect, useState } from 'react'
import type { Account, MailboxView, MessageRow, SyncStatus } from '@shared/types'
import MessageList, { accountLabel } from './MessageList'
import Reader from './reader/Reader'
import Compose from './compose/Compose'
import ScheduledList from './compose/ScheduledList'
import Settings from './settings/Settings'
import { useTheme } from './settings/theme'

type View = MailboxView | 'scheduled'

const VIEWS: { id: View; label: string }[] = [
  { id: 'inbox', label: 'Odebrane' },
  { id: 'starred', label: 'Oznaczone gwiazdką' },
  { id: 'archive', label: 'Archiwum' },
  { id: 'spam', label: 'Spam' },
  { id: 'trash', label: 'Kosz' },
  { id: 'scheduled', label: 'Zaplanowane' }
]

function SyncIndicator({ statuses }: { statuses: SyncStatus[] }): JSX.Element | null {
  const active = statuses.filter((s) => s.state === 'syncing')
  const errors = statuses.filter((s) => s.state === 'error')
  if (active.length > 0) {
    const done = active.reduce((n, s) => n + s.done, 0)
    const total = active.reduce((n, s) => n + s.total, 0)
    return (
      <div className="sync">
        <span className="spinner" />
        {total > 0 ? `Pobieranie ${done} / ${total}` : 'Łączenie…'}
      </div>
    )
  }
  if (errors.length > 0) {
    return (
      <div className="sync error" title={errors.map((e) => e.error).join('\n')}>
        Błąd synchronizacji: {errors[0].error}
      </div>
    )
  }
  return null
}

export default function App(): JSX.Element {
  const [messages, setMessages] = useState<MessageRow[]>([])
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [theme, setTheme] = useTheme()
  const [sync, setSync] = useState<Record<number, SyncStatus>>({})
  const [accounts, setAccounts] = useState<Account[]>([])
  // null = "Wszystko" (zunifikowana skrzynka), liczba = id konta
  const [inbox, setInbox] = useState<number | null>(null)
  const [view, setView] = useState<View>('inbox')
  // zwiększane po akcji na wiadomościach, żeby pobrać listę od nowa
  const [version, setVersion] = useState(0)
  // wiadomość otwarta w czytniku
  const [openId, setOpenId] = useState<number | null>(null)
  const [composeOpen, setComposeOpen] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), 5000)
    return () => clearTimeout(timer)
  }, [toast])

  const refreshAccounts = (): void => {
    window.api.listAccounts().then((list) => {
      setAccounts(list)
      // wybrana skrzynka mogła zostać usunięta w ustawieniach
      setInbox((cur) => (cur !== null && !list.some((a) => a.id === cur) ? null : cur))
    })
  }

  useEffect(refreshAccounts, [])

  useEffect(() => {
    // po przełączeniu skrzynki spóźniona odpowiedź z poprzedniej nie może nadpisać listy
    let current = true
    const refresh = (): void => {
      if (view === 'scheduled') return
      void window.api.listMessages({ accountId: inbox, view }).then((rows) => current && setMessages(rows))
    }
    refresh()
    const unsubscribe = window.api.onSyncStatus((status) => {
      setSync((prev) => ({ ...prev, [status.accountId]: status }))
      refresh()
    })
    return () => {
      current = false
      unsubscribe()
    }
  }, [inbox, view, accounts, version])

  const closeReader = useCallback(() => setOpenId(null), [])
  const accountsById = new Map(accounts.map((a) => [a.id, a]))
  const selected = inbox === null ? null : accountsById.get(inbox)
  const viewLabel = VIEWS.find((v) => v.id === view)!.label

  return (
    <div className="app">
      <aside className="sidebar">
        <h1>ZIM</h1>
        <button
          className="compose-btn"
          onClick={() => setComposeOpen(true)}
          disabled={accounts.length === 0}
          aria-label="Nowa wiadomość"
          title={accounts.length === 0 ? 'Najpierw dodaj konto w ustawieniach' : 'Nowa wiadomość'}
        >
          +
        </button>
        <nav>
          <div className="nav-label">Skrzynki</div>
          <button className={`view ${inbox === null ? 'active' : ''}`} onClick={() => setInbox(null)}>
            Wszystko
          </button>
          {accounts.map((a) => (
            <button
              key={a.id}
              className={`view ${inbox === a.id ? 'active' : ''}`}
              onClick={() => setInbox(a.id)}
              title={a.email}
            >
              {accountLabel(a)}
            </button>
          ))}
        </nav>
        <nav>
          <div className="nav-label">Foldery</div>
          {VIEWS.map((v) => (
            <button
              key={v.id}
              className={`view ${view === v.id ? 'active' : ''}`}
              onClick={() => setView(v.id)}
            >
              {v.label}
            </button>
          ))}
        </nav>
        <nav>
          <div className="nav-label">Widoki</div>
          <div className="view">Główna</div>
          <div className="view">Rekrutacje</div>
          <div className="view">Newslettery</div>
        </nav>
        <div className="sidebar-footer">
          <SyncIndicator statuses={Object.values(sync)} />
          <button
            className="icon-btn gear"
            onClick={() => setSettingsOpen(true)}
            aria-label="Ustawienia"
            title="Ustawienia"
          >
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor"
              strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1.08-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1.08 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.26.6.85 1 1.51 1H21a2 2 0 1 1 0 4h-.09c-.66 0-1.25.4-1.51 1z" />
            </svg>
          </button>
        </div>
      </aside>
      {view === 'scheduled' ? (
        <ScheduledList
          key={`${inbox ?? 'all'}:scheduled`}
          title={`${selected ? accountLabel(selected) : 'Wszystko'} · ${viewLabel}`}
          accountId={inbox}
          accountsById={accountsById}
          showAccount={inbox === null}
        />
      ) : (
        <MessageList
          // nowa skrzynka/folder = świeże zaznaczenie
          key={`${inbox ?? 'all'}:${view}`}
          title={`${selected ? accountLabel(selected) : 'Wszystko'} · ${viewLabel}`}
          subtitle={selected?.alias ? selected.email : null}
          view={view}
          messages={messages}
          accountsById={accountsById}
          // w pojedynczej skrzynce etykieta konta byłaby taka sama w każdym wierszu
          showAccount={inbox === null}
          hasAccounts={accounts.length > 0}
          onChanged={() => setVersion((v) => v + 1)}
          onOpen={setOpenId}
        />
      )}
      {composeOpen && (
        <Compose
          accounts={accounts}
          defaultAccountId={inbox}
          onClose={() => setComposeOpen(false)}
          onDone={setToast}
        />
      )}
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
      {openId !== null && (
        <Reader
          id={openId}
          accountsById={accountsById}
          onClose={closeReader}
          onChanged={() => setVersion((v) => v + 1)}
        />
      )}
      {settingsOpen && (
        <Settings
          theme={theme}
          onThemeChange={setTheme}
          onAccountsChange={refreshAccounts}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </div>
  )
}
