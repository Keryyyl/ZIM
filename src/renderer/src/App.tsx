import { useCallback, useEffect, useRef, useState } from 'react'
import type { Account, MailboxView, MessageRow, SyncStatus, Tag } from '@shared/types'
import MessageList, { accountLabel } from './MessageList'
import Reader from './reader/Reader'
import Compose from './compose/Compose'
import ScheduledList from './compose/ScheduledList'
import Settings from './settings/Settings'
import { useTheme } from './settings/theme'
import { useShortcuts } from './settings/shortcuts'
import { FOLDERS, useHiddenFolders } from './settings/folders'
import { useSidebarCollapsed } from './settings/sidebar'

type View = MailboxView | 'scheduled'

const VIEWS = FOLDERS satisfies { id: View; label: string }[]

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
  const [hiddenFolders, setFolderHidden] = useHiddenFolders()
  const [shortcuts, setShortcut] = useShortcuts()
  const [sidebarCollapsed, toggleSidebar] = useSidebarCollapsed()
  const [sync, setSync] = useState<Record<number, SyncStatus>>({})
  const [accounts, setAccounts] = useState<Account[]>([])
  // null = "Wszystko" (zunifikowana skrzynka), liczba = id konta
  const [inbox, setInbox] = useState<number | null>(null)
  const [view, setView] = useState<View>('inbox')
  // lista tagów w sidebarze; wybrany tag filtruje wiadomości z odebranych i archiwum
  const [tags, setTags] = useState<Tag[]>([])
  const [tagFilter, setTagFilter] = useState<number | null>(null)
  // zwiększane po akcji na wiadomościach, żeby pobrać listę od nowa
  const [version, setVersion] = useState(0)
  // wiadomość otwarta w czytniku
  const [openId, setOpenId] = useState<number | null>(null)
  // fraza wpisana w polu szukania i jej opóźniona wersja, po której faktycznie szukamy
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [composeOpen, setComposeOpen] = useState(false)
  const [replyTo, setReplyTo] = useState<{ accountId: number; to: string; subject: string } | undefined>()
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
    void window.api.listTags().then((list) => {
      setTags(list)
      // wybrany tag mógł zostać usunięty w ustawieniach
      setTagFilter((cur) => (cur !== null && !list.some((t) => t.id === cur) ? null : cur))
    })
  }, [version])

  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), 200)
    return () => clearTimeout(timer)
  }, [search])

  useEffect(() => {
    // po przełączeniu skrzynki spóźniona odpowiedź z poprzedniej nie może nadpisać listy
    let current = true
    const refresh = (): void => {
      if (view === 'scheduled') return
      const request = query
        ? window.api.searchMessages({ accountId: inbox, text: query })
        : window.api.listMessages({ accountId: inbox, view, tagId: tagFilter })
      void request.then((rows) => current && setMessages(rows))
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
  }, [inbox, view, tagFilter, accounts, version, query])

  // ukryty folder dalej istnieje w tle; jeśli właśnie go oglądamy, wracamy do odebranych
  useEffect(() => {
    if (hiddenFolders.has(view)) setView('inbox')
  }, [hiddenFolders, view])

  // skróty działają w czytniku; wyłączone w polach tekstowych, przy pisaniu i w ustawieniach
  const keyState = { openId, messages, view: tagFilter !== null ? ('starred' as const) : view, shortcuts, blocked: composeOpen || settingsOpen }
  const keyRef = useRef(keyState)
  keyRef.current = keyState

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const { openId, messages, view, shortcuts, blocked } = keyRef.current
      if (openId === null || blocked || e.metaKey || e.ctrlKey || e.altKey) return
      const t = e.target as HTMLElement
      if (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)) return
      const index = messages.findIndex((m) => m.id === openId)
      if (index < 0) return
      const next = messages[index + 1]?.id
      const prev = messages[index - 1]?.id
      if (e.key === shortcuts.next) {
        if (next !== undefined) setOpenId(next)
      } else if (e.key === shortcuts.prev) {
        if (prev !== undefined) setOpenId(prev)
      } else if (e.key === shortcuts.archive) {
        if (view !== 'inbox' && view !== 'starred') return
        void window.api.moveMessages([openId], 'archive').then(() => {
          setOpenId(next ?? prev ?? null)
          setVersion((v) => v + 1)
          setToast('Zarchiwizowano')
        })
      } else if (e.key === shortcuts.reply) {
        void window.api.getMessage(openId).then((m) => {
          if (!m) return
          const to = /<([^>]+)>/.exec(m.from)?.[1] ?? m.from
          const subject = /^re:/i.test(m.subject) ? m.subject : `Re: ${m.subject}`
          setReplyTo({ accountId: m.accountId, to, subject })
          setOpenId(null)
          setComposeOpen(true)
        })
      } else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // C = nowa wiadomość, G i litera = przejście do folderu (nie w czytniku, tam działają skróty wiadomości)
  const navRef = useRef({ blocked: false, hidden: hiddenFolders, accounts: accounts.length, reader: false })
  navRef.current = { blocked: composeOpen || settingsOpen, hidden: hiddenFolders, accounts: accounts.length, reader: openId !== null }

  useEffect(() => {
    let gAt = 0
    const onKey = (e: KeyboardEvent): void => {
      const nav = navRef.current
      if (nav.blocked || nav.reader || e.metaKey || e.ctrlKey || e.altKey) return
      const t = e.target as HTMLElement
      if (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)) return
      const key = e.key.toLowerCase()
      if (Date.now() - gAt < 1500) {
        gAt = 0
        const folder = FOLDERS.find((f) => f.key === key)
        if (!folder || nav.hidden.has(folder.id)) return
        setView(folder.id)
        setTagFilter(null)
        setSearch('')
      } else if (key === 'g') {
        gAt = Date.now()
      } else if (key === 'c' && nav.accounts > 0) {
        setReplyTo(undefined)
        setComposeOpen(true)
      } else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Cmd/Ctrl+B chowa i przywraca pasek boczny (działa też w polu szukania)
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey || e.key.toLowerCase() !== 'b') return
      if (navRef.current.blocked) return
      e.preventDefault()
      toggleSidebar()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const closeReader = useCallback(() => setOpenId(null), [])
  const accountsById = new Map(accounts.map((a) => [a.id, a]))
  const selected = inbox === null ? null : accountsById.get(inbox)
  const filterTag = tags.find((t) => t.id === tagFilter)
  const viewLabel = filterTag ? filterTag.name : VIEWS.find((v) => v.id === view)!.label

  return (
    <div className={`app ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
      <div className="titlebar-drag" />
      <aside className="sidebar">
        <h1>ZIM</h1>
        <button
          className="compose-btn"
          onClick={() => {
            setReplyTo(undefined)
            setComposeOpen(true)
          }}
          disabled={accounts.length === 0}
          aria-label="Nowa wiadomość"
          title={accounts.length === 0 ? 'Najpierw dodaj konto w ustawieniach' : 'Nowa wiadomość'}
        >
          <span className="compose-plus">+</span>
          <span className="compose-label">Napisz</span>
          <kbd className="hint">
            <span />
            <span>C</span>
          </kbd>
        </button>
        <nav>
          {VIEWS.filter((v) => !hiddenFolders.has(v.id)).map((v) => (
            <button
              key={v.id}
              className={`view ${view === v.id && tagFilter === null ? 'active' : ''}`}
              onClick={() => {
                setView(v.id)
                setTagFilter(null)
                setSearch('')
              }}
            >
              <span className="view-label">{v.label}</span>
              <kbd className="hint">
                <span>G</span>
                <span>{v.key.toUpperCase()}</span>
              </kbd>
            </button>
          ))}
        </nav>
        {tags.length > 0 && (
          <nav aria-label="Tagi">
            <div className="nav-label">Tagi</div>
            {tags.map((t) => (
              <button
                key={t.id}
                className={`view ${tagFilter === t.id ? 'active' : ''}`}
                onClick={() => {
                  setView('inbox')
                  setTagFilter(t.id)
                  setSearch('')
                }}
              >
                <span className="view-tag" style={t.color ? ({ '--tag': t.color } as React.CSSProperties) : undefined}>
                  <span className="tag-dot" />
                  <span className="view-label">{t.name}</span>
                </span>
              </button>
            ))}
          </nav>
        )}
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
          onToggleSidebar={toggleSidebar}
          key={`${inbox ?? 'all'}:scheduled`}
          title={`${selected ? accountLabel(selected) : 'Wszystko'} · ${viewLabel}`}
          accountId={inbox}
          accountsById={accountsById}
          showAccount={inbox === null}
        />
      ) : (
        <MessageList
          onToggleSidebar={toggleSidebar}
          // nowa skrzynka/folder = świeże zaznaczenie
          key={`${inbox ?? 'all'}:${view}:${tagFilter}`}
          title={viewLabel}
          subtitle={selected?.alias ? selected.email : null}
          // widok tagu miesza odebrane i archiwum, tak jak gwiazdki, więc ma te same akcje
          view={tagFilter !== null ? 'starred' : view}
          emptyText={filterTag ? 'Żadna wiadomość nie ma tego tagu.' : undefined}
          messages={messages}
          accountsById={accountsById}
          // w pojedynczej skrzynce etykieta konta byłaby taka sama w każdym wierszu
          showAccount={inbox === null}
          hasAccounts={accounts.length > 0}
          accounts={accounts}
          inbox={inbox}
          onSelectInbox={setInbox}
          onChanged={() => setVersion((v) => v + 1)}
          onOpen={setOpenId}
          search={search}
          searchActive={query !== ''}
          onSearch={setSearch}
        />
      )}
      {composeOpen && (
        <Compose
          accounts={accounts}
          defaultAccountId={inbox}
          initial={replyTo}
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
          shortcuts={shortcuts}
          onShortcutChange={setShortcut}
          hiddenFolders={hiddenFolders}
          onFolderHiddenChange={setFolderHidden}
          onAccountsChange={refreshAccounts}
          onTagsChange={() => setVersion((v) => v + 1)}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </div>
  )
}
