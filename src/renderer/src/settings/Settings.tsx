import { useEffect, useState, type FormEvent } from 'react'
import type { Account, Tag } from '@shared/types'
import TagChip, { ColorPicker, TAG_COLORS } from '../TagChip'
import { guessSmtp } from '@shared/smtp'
import { ACCENTS, type Theme, type ThemeMode } from './theme'
import { FOLDERS, type FolderId } from './folders'
import { SIDEBAR_SHORTCUT } from './sidebar'
import { SHORTCUT_ACTIONS, type ShortcutAction, type ShortcutMap } from './shortcuts'

type Section = 'themes' | 'folders' | 'tags' | 'accounts' | 'shortcuts' | 'about'

const SECTIONS: { id: Section; label: string }[] = [
  { id: 'themes', label: 'Motywy' },
  { id: 'folders', label: 'Foldery' },
  { id: 'tags', label: 'Tagi' },
  { id: 'accounts', label: 'Dodawanie adresu mail' },
  { id: 'shortcuts', label: 'Skróty klawiszowe' },
  { id: 'about', label: 'O aplikacji' }
]

interface Props {
  theme: Theme
  onThemeChange: (t: Theme) => void
  shortcuts: ShortcutMap
  onShortcutChange: (action: ShortcutAction, key: string) => void
  hiddenFolders: Set<FolderId>
  onFolderHiddenChange: (id: FolderId, hidden: boolean) => void
  /** Po dodaniu/usunięciu konta lub zmianie aliasu, żeby sidebar od razu pokazał nową nazwę */
  onAccountsChange: () => void
  /** Po utworzeniu, zmianie lub usunięciu tagu, żeby lista wiadomości pokazała aktualne tagi */
  onTagsChange: () => void
  onClose: () => void
}

export default function Settings({
  theme,
  onThemeChange,
  shortcuts,
  onShortcutChange,
  hiddenFolders,
  onFolderHiddenChange,
  onAccountsChange,
  onTagsChange,
  onClose
}: Props): JSX.Element {
  const [section, setSection] = useState<Section>('themes')

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="settings" role="dialog" aria-label="Ustawienia">
        <nav className="settings-nav">
          <h2>Ustawienia</h2>
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              className={`view ${section === s.id ? 'active' : ''}`}
              onClick={() => setSection(s.id)}
            >
              {s.label}
            </button>
          ))}
        </nav>
        <section className="settings-body">
          <button className="icon-btn close" onClick={onClose} aria-label="Zamknij">
            ✕
          </button>
          {section === 'themes' && <Themes theme={theme} onChange={onThemeChange} />}
          {section === 'folders' && <Folders hidden={hiddenFolders} onChange={onFolderHiddenChange} />}
          {section === 'tags' && <Tags onChange={onTagsChange} />}
          {section === 'accounts' && <Accounts onChange={onAccountsChange} />}
          {section === 'shortcuts' && <Shortcuts shortcuts={shortcuts} onChange={onShortcutChange} />}
          {section === 'about' && <About />}
        </section>
      </div>
    </div>
  )
}

function Folders({
  hidden,
  onChange
}: {
  hidden: Set<FolderId>
  onChange: (id: FolderId, hidden: boolean) => void
}): JSX.Element {
  return (
    <>
      <h3>Foldery</h3>
      <p className="muted">
        Wybierz, które foldery są widoczne w pasku bocznym. Ukryte foldery dalej istnieją i działają w tle
        (synchronizacja, reguły, spam), po prostu ich nie widać.
      </p>
      <ul className="folder-toggles">
        {FOLDERS.map((f) => (
          <li key={f.id}>
            <label>
              <span className="folder-toggle-text">
                <span>{f.label}</span>
                <span className="muted">{f.description}</span>
              </span>
              <input
                type="checkbox"
                role="switch"
                className="switch"
                checked={!hidden.has(f.id)}
                disabled={f.locked}
                onChange={(e) => onChange(f.id, !e.target.checked)}
              />
            </label>
          </li>
        ))}
      </ul>
    </>
  )
}

function Tags({ onChange }: { onChange: () => void }): JSX.Element {
  const [tags, setTags] = useState<Tag[]>([])
  const [name, setName] = useState('')
  const [color, setColor] = useState<string>(TAG_COLORS[0])
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<number | null>(null)
  const [draft, setDraft] = useState({ name: '', color: TAG_COLORS[0] as string | null })

  const load = (): void => void window.api.listTags().then(setTags)
  useEffect(load, [])

  const run = async (fn: () => Promise<unknown>): Promise<boolean> => {
    try {
      await fn()
      setError(null)
      load()
      onChange()
      return true
    } catch (err) {
      setError(ipcError(err))
      return false
    }
  }

  const create = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    if (await run(() => window.api.createTag(name, color))) setName('')
  }

  const save = async (id: number): Promise<void> => {
    if (await run(() => window.api.updateTag(id, draft.name, draft.color))) setEditing(null)
  }

  const remove = (tag: Tag): void => {
    if (window.confirm(`Usunąć tag „${tag.name}”? Zniknie ze wszystkich wiadomości.`)) {
      void run(() => window.api.deleteTag(tag.id))
    }
  }

  return (
    <>
      <h3>Tagi</h3>
      <p className="muted">
        Tutaj tworzysz własne tagi. W wiadomościach można potem dodawać tylko te, które są na tej liście. Tagi są
        zapisane lokalnie i nie trafiają na serwer poczty.
      </p>
      <form className="tag-form" onSubmit={create}>
        <input
          value={name}
          maxLength={30}
          placeholder="Nazwa nowego tagu"
          aria-label="Nazwa nowego tagu"
          onChange={(e) => setName(e.target.value)}
        />
        <ColorPicker value={color} onChange={setColor} />
        <button className="btn primary" disabled={!name.trim()}>
          Dodaj tag
        </button>
      </form>
      {error && <p className="error">{error}</p>}
      {tags.length === 0 ? (
        <p className="muted">Nie masz jeszcze żadnych tagów.</p>
      ) : (
        <ul className="tag-list">
          {tags.map((t) => (
            <li key={t.id}>
              {editing === t.id ? (
                <>
                  <input
                    autoFocus
                    value={draft.name}
                    maxLength={30}
                    aria-label={`Nazwa tagu ${t.name}`}
                    onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                    onKeyDown={(e) => {
                      // Esc anuluje edycję zamiast zamykać całe ustawienia
                      if (e.key === 'Escape') {
                        e.stopPropagation()
                        setEditing(null)
                      }
                      if (e.key === 'Enter') void save(t.id)
                    }}
                  />
                  <ColorPicker value={draft.color} onChange={(c) => setDraft({ ...draft, color: c })} />
                  <span className="account-actions">
                    <button className="btn" onClick={() => setEditing(null)}>
                      Anuluj
                    </button>
                    <button className="btn primary" onClick={() => void save(t.id)}>
                      Zapisz
                    </button>
                  </span>
                </>
              ) : (
                <>
                  <TagChip tag={t} />
                  <span className="account-actions">
                    <button
                      className="btn"
                      onClick={() => {
                        setDraft({ name: t.name, color: t.color })
                        setEditing(t.id)
                      }}
                    >
                      Edytuj
                    </button>
                    <button className="btn danger" onClick={() => remove(t)}>
                      Usuń
                    </button>
                  </span>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

const MODES: { id: ThemeMode; label: string }[] = [
  { id: 'system', label: 'Systemowy' },
  { id: 'light', label: 'Jasny' },
  { id: 'dark', label: 'Ciemny' }
]

function Themes({ theme, onChange }: { theme: Theme; onChange: (t: Theme) => void }): JSX.Element {
  return (
    <>
      <h3>Motyw</h3>
      <div className="segmented">
        {MODES.map((m) => (
          <button
            key={m.id}
            className={theme.mode === m.id ? 'active' : ''}
            onClick={() => onChange({ ...theme, mode: m.id })}
          >
            {m.label}
          </button>
        ))}
      </div>
      <h3>Kolor akcentu</h3>
      <div className="swatches">
        {ACCENTS.map((a) => (
          <button
            key={a.value}
            className={`swatch ${theme.accent === a.value ? 'active' : ''}`}
            style={{ background: a.value }}
            title={a.name}
            aria-label={a.name}
            onClick={() => onChange({ ...theme, accent: a.value })}
          />
        ))}
      </div>
    </>
  )
}

// Popularne serwery IMAP, żeby nie trzeba było ich wpisywać ręcznie.
const PRESETS: Record<string, { host: string; port: number }> = {
  'gmail.com': { host: 'imap.gmail.com', port: 993 },
  'googlemail.com': { host: 'imap.gmail.com', port: 993 },
  'icloud.com': { host: 'imap.mail.me.com', port: 993 },
  'me.com': { host: 'imap.mail.me.com', port: 993 },
  'wp.pl': { host: 'imap.wp.pl', port: 993 },
  'o2.pl': { host: 'poczta.o2.pl', port: 993 },
  'onet.pl': { host: 'imap.poczta.onet.pl', port: 993 },
  'op.pl': { host: 'imap.poczta.onet.pl', port: 993 },
  'interia.pl': { host: 'poczta.interia.pl', port: 993 },
  'yahoo.com': { host: 'imap.mail.yahoo.com', port: 993 },
  'fastmail.com': { host: 'imap.fastmail.com', port: 993 }
}

const EMPTY = { email: '', alias: '', imapHost: '', imapPort: '993', smtpHost: '', smtpPort: '', username: '', password: '' }

function Accounts({ onChange }: { onChange: () => void }): JSX.Element {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [form, setForm] = useState(EMPTY)
  const [hostTouched, setHostTouched] = useState(false)
  // dopóki użytkownik nie zmieni SMTP ręcznie, podpowiadamy go na podstawie serwera IMAP
  const [smtpTouched, setSmtpTouched] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    window.api.listAccounts().then(setAccounts)
  }, [])

  const guessed = form.imapHost.trim() ? guessSmtp(form.imapHost) : null
  const smtpHost = smtpTouched ? form.smtpHost : (guessed?.host ?? '')
  const smtpPort = smtpTouched ? form.smtpPort : String(guessed?.port ?? 465)

  const onEmail = (email: string): void => {
    const preset = PRESETS[email.split('@')[1]?.toLowerCase() ?? '']
    setForm((f) => ({
      ...f,
      email,
      ...(preset && !hostTouched ? { imapHost: preset.host, imapPort: String(preset.port) } : {})
    }))
  }

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    setError(null)
    setSaving(true)
    try {
      const account = await window.api.addAccount({
        email: form.email,
        alias: form.alias,
        imapHost: form.imapHost,
        imapPort: Number(form.imapPort),
        smtpHost,
        smtpPort: Number(smtpPort),
        username: form.username || form.email,
        password: form.password
      })
      setAccounts((a) => [...a, account])
      onChange()
      setForm(EMPTY)
      setHostTouched(false)
      setSmtpTouched(false)
    } catch (err) {
      setError(ipcError(err))
    } finally {
      setSaving(false)
    }
  }

  const remove = async (id: number): Promise<void> => {
    await window.api.removeAccount(id)
    setAccounts((a) => a.filter((x) => x.id !== id))
    onChange()
  }

  return (
    <>
      <h3>Twoje konta</h3>
      {accounts.length === 0 ? (
        <p className="muted">Nie dodano jeszcze żadnego konta.</p>
      ) : (
        <ul className="accounts">
          {accounts.map((a) => (
            <AccountItem
              key={a.id}
              account={a}
              onAliasChange={(alias) => {
                setAccounts((list) => list.map((x) => (x.id === a.id ? { ...x, alias } : x)))
                onChange()
              }}
              onRemove={() => remove(a.id)}
            />
          ))}
        </ul>
      )}

      <h3>Dodaj adres mail</h3>
      <form className="form" onSubmit={submit}>
        <label>
          Adres e-mail
          <input
            type="email"
            required
            value={form.email}
            onChange={(e) => onEmail(e.target.value)}
            placeholder="jan@gmail.com"
          />
        </label>
        <label>
          Alias <span className="muted">(nazwa skrzynki, domyślnie adres e-mail)</span>
          <input
            value={form.alias}
            onChange={(e) => setForm({ ...form, alias: e.target.value })}
            placeholder="np. Praca, Prywatna"
            maxLength={40}
          />
        </label>
        <div className="form-row">
          <label className="grow">
            Serwer IMAP
            <input
              required
              value={form.imapHost}
              onChange={(e) => {
                setHostTouched(true)
                setForm({ ...form, imapHost: e.target.value })
              }}
              placeholder="imap.example.com"
            />
          </label>
          <label className="port">
            Port
            <input
              type="number"
              required
              min={1}
              max={65535}
              value={form.imapPort}
              onChange={(e) => setForm({ ...form, imapPort: e.target.value })}
            />
          </label>
        </div>
        <div className="form-row">
          <label className="grow">
            Serwer SMTP <span className="muted">(wysyłka)</span>
            <input
              required
              value={smtpHost}
              onChange={(e) => {
                setSmtpTouched(true)
                setForm({ ...form, smtpHost: e.target.value, smtpPort })
              }}
              placeholder="smtp.example.com"
            />
          </label>
          <label className="port">
            Port
            <input
              type="number"
              required
              min={1}
              max={65535}
              value={smtpPort}
              onChange={(e) => {
                setSmtpTouched(true)
                setForm({ ...form, smtpHost, smtpPort: e.target.value })
              }}
            />
          </label>
        </div>
        <label>
          Login <span className="muted">(domyślnie adres e-mail)</span>
          <input
            value={form.username}
            onChange={(e) => setForm({ ...form, username: e.target.value })}
            placeholder={form.email}
          />
        </label>
        <label>
          Hasło
          <input
            type="password"
            required
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
          />
        </label>
        <p className="muted hint">
          Hasło jest szyfrowane w pęku kluczy systemu i nie opuszcza tego komputera. Dla Gmaila
          i iCloud użyj hasła aplikacji.
        </p>
        {error && <p className="error">{error}</p>}
        <button className="btn primary" type="submit" disabled={saving}>
          {saving ? 'Dodawanie…' : 'Dodaj konto'}
        </button>
      </form>
    </>
  )
}

/** IPC dokleja prefiks "Error invoking remote method ..." */
function ipcError(err: unknown): string {
  return String(err).replace(/^.*Error: /, '')
}

interface AccountItemProps {
  account: Account
  onAliasChange: (alias: string | null) => void
  onRemove: () => void
}

function AccountItem({ account: a, onAliasChange, onRemove }: AccountItemProps): JSX.Element {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)

  const startEdit = (): void => {
    setDraft(a.alias ?? '')
    setError(null)
    setEditing(true)
  }

  const save = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    try {
      onAliasChange(await window.api.setAccountAlias(a.id, draft))
      setEditing(false)
    } catch (err) {
      setError(ipcError(err))
    }
  }

  return (
    <li>
      {editing ? (
        <form className="alias-edit" onSubmit={save}>
          <input
            autoFocus
            value={draft}
            maxLength={40}
            placeholder={a.email}
            aria-label={`Alias dla ${a.email}`}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              // Esc anuluje edycję zamiast zamykać całe ustawienia
              if (e.key === 'Escape') {
                e.stopPropagation()
                setEditing(false)
              }
            }}
          />
          <span className="muted">
            {a.email} · puste pole = wyświetlaj adres
          </span>
          {error && <span className="error">{error}</span>}
        </form>
      ) : (
        <div>
          <strong>{a.alias || a.email}</strong>
          <span className="muted">
            {a.alias ? `${a.email} · ` : ''}
            IMAP {a.imapHost}:{a.imapPort} · SMTP {a.smtpHost}:{a.smtpPort}
          </span>
        </div>
      )}
      <div className="account-actions">
        {editing ? (
          <>
            <button className="btn" onClick={() => setEditing(false)}>
              Anuluj
            </button>
            <button className="btn primary" onClick={save}>
              Zapisz
            </button>
          </>
        ) : (
          <>
            <button className="btn" onClick={startEdit}>
              Zmień alias
            </button>
            <button className="btn danger" onClick={onRemove}>
              Usuń
            </button>
          </>
        )}
      </div>
    </li>
  )
}

function Shortcuts({
  shortcuts,
  onChange
}: {
  shortcuts: ShortcutMap
  onChange: (action: ShortcutAction, key: string) => void
}): JSX.Element {
  // akcja, której skrót właśnie zmieniamy (czeka na wciśnięcie znaku)
  const [editing, setEditing] = useState<ShortcutAction | null>(null)

  useEffect(() => {
    if (!editing) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Shift' || e.key === 'Control' || e.key === 'Alt' || e.key === 'Meta') return
      // przechwytujemy zanim klawisz trafi do reszty aplikacji (Esc nie zamyka wtedy ustawień)
      e.preventDefault()
      e.stopPropagation()
      if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey && e.key !== ' ') onChange(editing, e.key)
      setEditing(null)
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [editing, onChange])

  return (
    <>
      <h3>Skróty klawiszowe</h3>
      <p className="muted">
        Kliknij skrót i wciśnij nowy znak, zapisze się od razu. Esc anuluje zmianę. Nawigacja j/k/e/r zacznie
        działać razem z czytnikiem wiadomości.
      </p>
      <table className="shortcuts">
        <tbody>
          {SHORTCUT_ACTIONS.map((a) => (
            <tr key={a.id}>
              <td>
                <button
                  className={`kbd-btn ${editing === a.id ? 'editing' : ''}`}
                  onClick={() => setEditing(editing === a.id ? null : a.id)}
                  title="Kliknij, aby zmienić"
                >
                  <kbd>{editing === a.id ? '…' : shortcuts[a.id]}</kbd>
                </button>
              </td>
              <td>{a.label}</td>
            </tr>
          ))}
          <tr>
            <td>
              <kbd>{SIDEBAR_SHORTCUT}</kbd>
            </td>
            <td>Pokaż / ukryj pasek boczny</td>
          </tr>
          <tr>
            <td>
              <kbd>Esc</kbd>
            </td>
            <td>Zamknij okno / wróć</td>
          </tr>
        </tbody>
      </table>
    </>
  )
}

function About(): JSX.Element {
  return (
    <>
      <h3>ZIM</h3>
      <p className="muted">Wersja 0.1.0</p>
      <p>
        Desktopowy klient mailowy: wiele skrzynek w jednej, tagi, reguły i klasyfikacja LLM. Dane
        i hasła zostają lokalnie na tym komputerze.
      </p>
    </>
  )
}
