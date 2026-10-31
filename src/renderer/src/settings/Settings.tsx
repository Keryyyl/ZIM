import { useEffect, useState, type FormEvent } from 'react'
import type { Account, AiConfig, AiState, AiStatus, Tag } from '@shared/types'
import { CLOUD_PROVIDERS, isCloud, KEY_HELP, MODEL_SUGGESTIONS, PROVIDER_LABELS, type CloudProvider } from '@shared/ai'
import TagChip, { ColorPicker, TAG_COLORS } from '../TagChip'
import { guessSmtp } from '@shared/smtp'
import { buildTemplate, parseThemeFile } from './customTheme'
import type { CustomThemes, Theme, ThemeMode } from './theme'
import { FOLDERS, type FolderId } from './folders'
import { RIGHT_SIDEBAR_SHORTCUT, SIDEBAR_SHORTCUT } from './sidebar'
import { SHORTCUT_ACTIONS, type ShortcutAction, type ShortcutMap } from './shortcuts'

type Section = 'themes' | 'folders' | 'tags' | 'ai' | 'accounts' | 'shortcuts' | 'about'

const SECTIONS: { id: Section; label: string }[] = [
  { id: 'themes', label: 'Motywy' },
  { id: 'folders', label: 'Foldery' },
  { id: 'tags', label: 'Tagi' },
  { id: 'ai', label: 'Asystent AI' },
  { id: 'accounts', label: 'Dodawanie adresu mail' },
  { id: 'shortcuts', label: 'Skróty klawiszowe' },
  { id: 'about', label: 'O aplikacji' }
]

interface Props {
  theme: Theme
  onThemeChange: (t: Theme) => void
  customThemes: CustomThemes
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
  customThemes,
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
          {section === 'themes' && <Themes theme={theme} onChange={onThemeChange} custom={customThemes} />}
          {section === 'folders' && <Folders hidden={hiddenFolders} onChange={onFolderHiddenChange} />}
          {section === 'tags' && <Tags onChange={onTagsChange} />}
          {section === 'ai' && <Assistant onChange={onTagsChange} />}
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
  const [description, setDescription] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<number | null>(null)
  const [draft, setDraft] = useState({ name: '', color: TAG_COLORS[0] as string | null, description: '' })

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
    if (await run(() => window.api.createTag(name, color, description))) {
      setName('')
      setDescription('')
    }
  }

  const save = async (id: number): Promise<void> => {
    if (await run(() => window.api.updateTag(id, draft.name, draft.color, draft.description))) setEditing(null)
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
        zapisane lokalnie i nie trafiają na serwer poczty. Opis podpowiada asystentowi AI, kiedy użyć tagu.
      </p>
      <p className="muted">
        Tagi ważności (Pilne, Luźne, Zachować) są wbudowane: porządkują Odebrane, a „Zachować” przenosi wiadomość do
        Archiwum. Możesz zmienić ich nazwę, kolor i opis dla AI, ale nie możesz ich usunąć.
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
        <input
          className="tag-desc"
          value={description}
          maxLength={200}
          placeholder="Opis dla AI, np. potwierdzenia złożenia aplikacji i odpowiedzi rekruterów"
          aria-label="Opis nowego tagu dla AI"
          onChange={(e) => setDescription(e.target.value)}
        />
      </form>
      {error && <p className="error">{error}</p>}
      {tags.length === 0 ? (
        <p className="muted">Nie masz jeszcze żadnych tagów.</p>
      ) : (
        <ul className="tag-list">
          {tags.map((t, i) => (
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
                  <input
                    className="tag-desc"
                    value={draft.description}
                    maxLength={200}
                    placeholder="Opis dla AI"
                    aria-label={`Opis tagu ${t.name} dla AI`}
                    onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') {
                        e.stopPropagation()
                        setEditing(null)
                      }
                      if (e.key === 'Enter') void save(t.id)
                    }}
                  />
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
                  <span className="tag-row-main">
                    <span className="tag-row-title">
                      <TagChip tag={t} />
                      {t.system && (
                        <span className="tag-builtin" title="Tag wbudowany: można zmienić nazwę, kolor i opis, ale nie usunąć">
                          wbudowany
                        </span>
                      )}
                    </span>
                    {t.description && <span className="muted tag-row-desc">{t.description}</span>}
                  </span>
                  <span className="account-actions">
                    <button
                      className="btn"
                      disabled={i === 0}
                      aria-label={`Przesuń tag ${t.name} w górę`}
                      title="W górę"
                      onClick={() => void run(() => window.api.moveTag(t.id, 'up'))}
                    >
                      ↑
                    </button>
                    <button
                      className="btn"
                      disabled={i === tags.length - 1}
                      aria-label={`Przesuń tag ${t.name} w dół`}
                      title="W dół"
                      onClick={() => void run(() => window.api.moveTag(t.id, 'down'))}
                    >
                      ↓
                    </button>
                    <button
                      className="btn"
                      onClick={() => {
                        setDraft({ name: t.name, color: t.color, description: t.description })
                        setEditing(t.id)
                      }}
                    >
                      Edytuj
                    </button>
                    {!t.system && (
                      <button className="btn danger" onClick={() => remove(t)}>
                        Usuń
                      </button>
                    )}
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

const AI_STATE_TEXT: Record<AiState, string> = {
  disabled: 'Wyłączony',
  idle: 'Gotowy',
  working: 'Taguje wiadomości…',
  unavailable: 'Model nie odpowiada',
  'no-model': 'Nie ma takiego modelu',
  'no-key': 'Problem z kluczem API',
  'no-tags': 'Najpierw utwórz tagi'
}

type Mode = 'none' | 'local' | 'cloud'

const MODE_LABELS: { id: Mode; label: string; hint: string }[] = [
  { id: 'none', label: 'Brak', hint: 'Żadnych tagów ani skrótów od AI' },
  { id: 'local', label: 'Pobrany model', hint: 'Działa na tym komputerze (Ollama), treść maili nigdzie nie wychodzi' },
  { id: 'cloud', label: 'Zewnętrzny model', hint: 'Claude albo ChatGPT przez internet, wymaga klucza API i zgody' }
]

function Assistant({ onChange }: { onChange: () => void }): JSX.Element {
  const [status, setStatus] = useState<AiStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [keyInput, setKeyInput] = useState('')
  const [consent, setConsent] = useState(false)
  // dostawca w chmurze wybrany w formularzu, zanim kliknięto „Włącz”
  const [cloud, setCloud] = useState<CloudProvider>('anthropic')
  // formularz zewnętrznego modelu jest otwarty, ale jeszcze nic nie włączono (brak klucza albo zgody)
  const [pendingCloud, setPendingCloud] = useState(false)
  const [modelDraft, setModelDraft] = useState<Partial<Record<CloudProvider, string>>>({})

  useEffect(() => {
    let current = true
    const load = (): void => void window.api.getAiStatus().then((s) => current && setStatus(s))
    load()
    const timer = setInterval(load, 2000)
    return () => {
      current = false
      clearInterval(timer)
    }
  }, [])

  // przy pierwszym wczytaniu pokaż dostawcę, który już działa
  const [synced, setSynced] = useState(false)
  useEffect(() => {
    if (status && !synced) {
      if (isCloud(status.provider)) setCloud(status.provider)
      setSynced(true)
    }
  }, [status, synced])

  if (!status) return <p className="muted">Wczytywanie…</p>

  const mode: Mode = !status.enabled ? 'none' : isCloud(status.provider) ? 'cloud' : 'local'
  const refresh = async (): Promise<void> => setStatus(await window.api.getAiStatus())

  const run = async (action: () => Promise<void>): Promise<void> => {
    try {
      await action()
      setError(null)
      await refresh()
    } catch (err) {
      setError(ipcError(err))
    }
  }

  const apply = (patch: Partial<AiConfig> & { consent?: boolean }): Promise<void> =>
    run(() =>
      window.api.setAiConfig({
        enabled: status.enabled,
        provider: status.provider,
        model: status.model,
        ...patch
      })
    )

  const chooseMode = (next: Mode): void => {
    if (next === 'none') void apply({ enabled: false })
    else if (next === 'local') void apply({ enabled: true, provider: 'ollama', model: status.modelsByProvider.ollama })
    else {
      // zewnętrzny: dopiero po kluczu i zgodzie (przycisk „Włącz”), żeby nic nie poszło do sieci bez wiedzy użytkownika
      setConsent(status.consent[cloud])
      if (status.enabled && isCloud(status.provider)) return
      setPendingCloud(true)
    }
  }
  // wybrana opcja w formularzu; przed kliknięciem „Włącz” różni się od faktycznie działającego trybu
  const shown: Mode = pendingCloud ? 'cloud' : mode
  const cloudOpen = shown === 'cloud'

  const pickCloud = (p: CloudProvider): void => {
    setCloud(p)
    setConsent(status.consent[p])
    setKeyInput('')
    // zmiana dostawcy przy działającym trybie zewnętrznym obowiązuje od razu, jeśli ma już klucz i zgodę
    if (mode === 'cloud' && status.keys[p] && status.consent[p]) {
      void apply({ provider: p, model: modelDraft[p] ?? status.modelsByProvider[p] })
    }
  }

  const saveKey = (): void =>
    void run(async () => {
      await window.api.setAiKey(cloud, keyInput)
      setKeyInput('')
    })

  const enableCloud = (): void =>
    void run(async () => {
      if (keyInput) {
        await window.api.setAiKey(cloud, keyInput)
        setKeyInput('')
      }
      await window.api.setAiConfig({
        enabled: true,
        provider: cloud,
        model: modelDraft[cloud] ?? status.modelsByProvider[cloud],
        consent: consent || status.consent[cloud]
      })
      setPendingCloud(false)
    })

  const reprocess = async (): Promise<void> => {
    await window.api.reprocessAi()
    await refresh()
    onChange()
  }

  const cloudModel = modelDraft[cloud] ?? status.modelsByProvider[cloud]
  const hasKey = status.keys[cloud]
  const mustConfirm = !status.consent[cloud]
  const active = mode !== 'none'
  const bad = status.state === 'unavailable' || status.state === 'no-model' || status.state === 'no-key'

  return (
    <>
      <h3>Asystent AI</h3>
      <p className="muted">
        Model przypisuje wiadomościom tagi z Twojej listy (ostatnie 30 dni w Odebranych i Archiwum) oraz pisze skrót
        otwartego maila. Tagi dodane ręcznie nigdy nie są zmieniane.
      </p>

      <fieldset className="ai-modes">
        <legend className="visually-hidden">Źródło modelu</legend>
        {MODE_LABELS.map((m) => (
          <label key={m.id} className={shown === m.id ? 'selected' : ''}>
            <input
              type="radio"
              name="ai-mode"
              checked={shown === m.id}
              onChange={() => {
                if (m.id !== 'cloud') setPendingCloud(false)
                chooseMode(m.id)
              }}
            />
            <span>
              <strong>{m.label}</strong>
              <span className="muted">{m.hint}</span>
            </span>
          </label>
        ))}
      </fieldset>

      {mode === 'local' && !pendingCloud && (
        <dl className="ai-status">
          <dt>Model</dt>
          <dd>
            <select
              value={status.model}
              onChange={(e) => void apply({ model: e.target.value })}
              aria-label="Model Ollamy"
            >
              {[...new Set([...(status.models ?? []), status.model])].map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </dd>
        </dl>
      )}
      {mode === 'local' && !pendingCloud && status.models === null && (
        <p className="error">
          Nie można połączyć się z Ollamą. Uruchom ją poleceniem <code>ollama serve</code> (albo aplikacją Ollama).
        </p>
      )}
      {mode === 'local' && !pendingCloud && status.models !== null && !status.models.includes(status.model) && (
        <p className="error">
          Modelu {status.model} nie ma w Ollamie. Pobierz go poleceniem <code>ollama pull {status.model}</code>.
        </p>
      )}

      {cloudOpen && (
        <div className="ai-cloud">
          <div className="ai-cloud-row">
            <label>
              Dostawca
              <select value={cloud} onChange={(e) => pickCloud(e.target.value as CloudProvider)}>
                {CLOUD_PROVIDERS.map((p) => (
                  <option key={p} value={p}>
                    {PROVIDER_LABELS[p]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Model
              <input
                list={`models-${cloud}`}
                value={cloudModel}
                onChange={(e) => setModelDraft({ ...modelDraft, [cloud]: e.target.value })}
                // przy działającym trybie zewnętrznym zmiana modelu obowiązuje po opuszczeniu pola
                onBlur={() => {
                  const value = cloudModel.trim()
                  if (value && mode === 'cloud' && status.provider === cloud && value !== status.model) {
                    void apply({ model: value })
                  }
                }}
                aria-label="Model"
              />
              <datalist id={`models-${cloud}`}>
                {MODEL_SUGGESTIONS[cloud].map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
            </label>
          </div>
          <label className="ai-key">
            Klucz API {hasKey && <span className="muted">· zapisany w Keychain</span>}
            <span className="ai-key-row">
              <input
                type="password"
                autoComplete="off"
                spellCheck={false}
                placeholder={hasKey ? 'wpisz nowy, aby zastąpić' : 'wklej klucz'}
                value={keyInput}
                onChange={(e) => setKeyInput(e.target.value)}
              />
              <button className="btn" onClick={saveKey} disabled={!keyInput.trim()}>
                Zapisz klucz
              </button>
              {hasKey && (
                <button className="btn" onClick={() => void run(() => window.api.setAiKey(cloud, null))}>
                  Usuń
                </button>
              )}
            </span>
            <span className="muted">
              Klucz zostaje w Keychain tego komputera, aplikacja nigdy go nie pokazuje. Wygenerujesz go na{' '}
              <code>{KEY_HELP[cloud].replace('https://', '')}</code>.
            </span>
          </label>
          {mustConfirm && (
            <label className="ai-consent">
              <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
              <span>
                Rozumiem, że do <strong>{PROVIDER_LABELS[cloud]}</strong> będą wysyłane: nadawca, temat i treść maili
                (do 2000 znaków do tagowania, do 3000 do skrótu), także starszych niż dziś: w kolejce jest teraz{' '}
                <strong>{status.pending}</strong> wiadomości. Płacisz u dostawcy za zapytania.
              </span>
            </label>
          )}
          {mode !== 'cloud' && (
            <button
              className="btn primary"
              onClick={enableCloud}
              disabled={(!hasKey && !keyInput.trim()) || (mustConfirm && !consent)}
            >
              Włącz {PROVIDER_LABELS[cloud]}
            </button>
          )}
        </div>
      )}

      {active && (
        <dl className="ai-status">
          <dt>Stan</dt>
          <dd className={bad ? 'error' : ''}>
            {AI_STATE_TEXT[status.state]}
            {status.pending > 0 && status.state !== 'disabled' && (
              <span className="muted"> · do otagowania: {status.pending}</span>
            )}
          </dd>
        </dl>
      )}
      {status.error && status.state !== 'idle' && active && <p className={bad ? 'error' : 'muted'}>{status.error}</p>}
      {error && <p className="error">{error}</p>}
      <p>
        <button className="btn" onClick={() => void reprocess()} disabled={!status.enabled}>
          Otaguj ponownie ostatnie 30 dni
        </button>
      </p>
      <p className="muted">
        Użyj po dodaniu nowych tagów albo zmianie modelu. Tagi nadane wcześniej przez AI zostaną zastąpione nowymi.
      </p>
    </>
  )
}

const MODES: { id: ThemeMode; label: string }[] = [
  { id: 'system', label: 'Systemowy' },
  { id: 'light', label: 'Jasny' },
  { id: 'dark', label: 'Ciemny' }
]

function Themes({
  theme,
  onChange,
  custom
}: {
  theme: Theme
  onChange: (t: Theme) => void
  custom: CustomThemes
}): JSX.Element {
  const [renaming, setRenaming] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const inUse = (id: string): boolean => theme.mode === 'custom' && theme.customId === id

  const attempt = (action: () => void): void => {
    try {
      action()
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const rename = (id: string): void =>
    attempt(() => {
      custom.rename(id, draft)
      setRenaming(null)
    })

  const remove = (id: string, name: string): void => {
    if (!window.confirm(`Usunąć motyw „${name}”?`)) return
    custom.remove(id) // używany motyw: aplikacja wraca do motywu systemowego
    setNotice(null)
  }

  // wartości z tego, co jest teraz na ekranie, żeby zmieniać gotowy zestaw zamiast zaczynać od zera
  const download = async (): Promise<void> => {
    const root = document.documentElement
    const style = getComputedStyle(root)
    const base = style.colorScheme === 'dark' ? 'dark' : 'light'
    try {
      const saved = await window.api.saveTextFile(
        'zim-motyw.json',
        buildTemplate(base, (key) => style.getPropertyValue(`--${key}`))
      )
      setError(null)
      setNotice(saved ? 'Zapisano plik motywu. Zmień w nim kolory i wgraj go z powrotem.' : null)
    } catch (err) {
      setError(String(err).replace(/^.*Error: /, ''))
    }
  }

  const upload = async (file: File | undefined): Promise<void> => {
    if (!file) return
    try {
      const added = custom.add(parseThemeFile(await file.text()))
      setError(null)
      setNotice(`Dodano motyw „${added.name}”.`)
    } catch (err) {
      setNotice(null)
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <>
      <h3>Motyw</h3>
      <div className="segmented">
        {MODES.map((m) => (
          <button
            key={m.id}
            className={theme.mode === m.id ? 'active' : ''}
            onClick={() => onChange({ mode: m.id })}
          >
            {m.label}
          </button>
        ))}
      </div>

      <h3>Stwórz własny</h3>
      {custom.themes.length === 0 ? (
        <p className="muted">Nie masz jeszcze własnych motywów.</p>
      ) : (
        <ul className="theme-list">
          {custom.themes.map((t) => (
            <li key={t.id}>
              {renaming === t.id ? (
                <>
                  <input
                    autoFocus
                    value={draft}
                    maxLength={40}
                    aria-label={`Nowa nazwa motywu ${t.name}`}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      // Esc anuluje zmianę nazwy zamiast zamykać całe ustawienia
                      if (e.key === 'Escape') {
                        e.stopPropagation()
                        setRenaming(null)
                        setError(null)
                      }
                      if (e.key === 'Enter') rename(t.id)
                    }}
                  />
                  <span className="account-actions">
                    <button className="btn" onClick={() => setRenaming(null)}>
                      Anuluj
                    </button>
                    <button className="btn primary" onClick={() => rename(t.id)}>
                      Zapisz
                    </button>
                  </span>
                </>
              ) : (
                <>
                  <span className="theme-name">
                    {t.name}
                    {inUse(t.id) && <span className="tag-builtin">w użyciu</span>}
                  </span>
                  <span className="account-actions">
                    <button
                      className="btn"
                      disabled={inUse(t.id)}
                      onClick={() => onChange({ mode: 'custom', customId: t.id })}
                    >
                      Użyj
                    </button>
                    <button
                      className="btn"
                      onClick={() => {
                        setDraft(t.name)
                        setRenaming(t.id)
                        setError(null)
                      }}
                    >
                      Zmień nazwę
                    </button>
                    <button className="btn danger" onClick={() => remove(t.id, t.name)}>
                      Usuń
                    </button>
                  </span>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      <p className="muted">Kliknij w przycisk pobierz by zmodyfikować motyw według własnego uznania</p>
      <p>
        <button className="btn" onClick={() => void download()}>
          Pobierz
        </button>
      </p>
      <p>
        <label className="btn upload-btn">
          Wgraj motyw
          <input
            type="file"
            accept=".json,application/json"
            hidden
            onChange={(e) => {
              void upload(e.target.files?.[0])
              e.target.value = '' // pozwala wgrać ten sam plik jeszcze raz po poprawce
            }}
          />
        </label>
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && <p className="muted">{notice}</p>}
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
            <td>Pokaż / ukryj lewy pasek boczny</td>
          </tr>
          <tr>
            <td>
              <kbd>{RIGHT_SIDEBAR_SHORTCUT}</kbd>
            </td>
            <td>Pokaż / ukryj prawy pasek boczny (kontakty)</td>
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
