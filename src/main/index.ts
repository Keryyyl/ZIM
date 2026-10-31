import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { randomUUID } from 'crypto'
import { copyFile, readFile, stat } from 'fs/promises'
import { basename, extname, join } from 'path'
import { openDb } from './db'
import { getAttachment } from './db/attachments'
import { CACHE_LIMIT, fetchAttachment, pruneCache } from './mail/attachment-cache'
import { isRisky, safeFilename } from './mail/attachments'
import { addAccount, getAccount, listAccounts, removeAccount, setAccountAlias, type NewAccount } from './db/accounts'
import {
  cancelScheduled,
  claimDue,
  listScheduled,
  markFailed,
  markSent,
  recoverInterrupted,
  retryScheduled,
  scheduleMail
} from './db/outbox'
import { sendMail, validateMail, type OutgoingMail } from './mail/send'
import {
  deleteForever,
  getMessage,
  listMessages,
  markNotSpam,
  markSpam,
  moveToFolder,
  sanitizeIds,
  setRead,
  searchMessages,
  setStarred
} from './db/messages'
import { contactMail, deleteContact, listContacts, saveContact } from './db/contacts'
import { createTag, deleteTag, listTags, moveTag, setMessageTag, updateTag } from './db/tags'
import { getAiConfig, setAiConfig } from './db/settings'
import { classifyWithOllama } from './classifier/llm'
import { listModels } from './classifier/ollama'
import { ensureOllamaRunning, stopOllama } from './classifier/ollama-server'
import { createClassifier, type Classifier } from './classifier/queue'
import { createSummarizer, summarizeWithOllama } from './classifier/summary'
import { syncAccount } from './mail/sync'
import { createSecretStore } from './secrets'
import type { Account, Folder, MessageQuery, OutgoingDraft, PickedFile, SyncStatus } from '@shared/types'

let db: ReturnType<typeof openDb>
let secrets: ReturnType<typeof createSecretStore>
let classifier: Classifier
const syncing = new Map<number, AbortController>()
// konta, dla których przyszła nowa zmiana w trakcie synchronizacji: po niej startujemy jeszcze raz
const rerun = new Set<number>()
// spinner "Łączenie…" tylko przy pierwszej synchronizacji, a nie przy każdym odpytaniu serwera
const syncedOnce = new Set<number>()
const POLL_MS = 60_000

// tagi od AI pojawiają się pojedynczo; UI odświeżamy najwyżej co chwilę
let taggedTimer: NodeJS.Timeout | undefined
function notifyTagged(): void {
  if (taggedTimer) return
  taggedTimer = setTimeout(() => {
    taggedTimer = undefined
    for (const win of BrowserWindow.getAllWindows()) win.webContents.send('ai:tagged')
  }, 1500)
}

function sendSyncStatus(status: SyncStatus): void {
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send('sync:status', status)
}

function startSync(account: Account): void {
  if (syncing.has(account.id)) {
    rerun.add(account.id)
    return
  }
  const password = secrets.get(`account:${account.id}`)
  if (!password) return
  const controller = new AbortController()
  syncing.set(account.id, controller)
  const base = { accountId: account.id }
  let progress = { done: 0, total: 0 }
  if (!syncedOnce.has(account.id)) sendSyncStatus({ ...base, state: 'syncing', ...progress })

  syncAccount(db, account, {
    password,
    signal: controller.signal,
    onProgress: (p) => {
      progress = p
      sendSyncStatus({ ...base, state: 'syncing', ...p })
    }
  })
    .then(() => {
      syncedOnce.add(account.id)
      sendSyncStatus({ ...base, state: 'idle', ...progress })
      classifier.kick() // nowe maile mogły właśnie wylądować w bazie
    })
    .catch((e: Error) => {
      if (controller.signal.aborted) return
      // komunikat z imapflow/serwera, bez danych logowania
      const message = (e as { responseText?: string }).responseText || e.message
      console.error(`sync ${account.email}:`, message)
      sendSyncStatus({ ...base, state: 'error', ...progress, error: message })
    })
    .finally(() => {
      syncing.delete(account.id)
      if (rerun.delete(account.id) && !controller.signal.aborted) startSync(account)
    })
}

function syncAll(): void {
  listAccounts(db).forEach(startSync)
}

let pushTimer: NodeJS.Timeout | undefined
/** Po akcji w ZIM: wypchnij zmiany na serwer (z krótkim opóźnieniem, żeby złączyć serię kliknięć). */
function schedulePush(): void {
  clearTimeout(pushTimer)
  pushTimer = setTimeout(syncAll, 300)
}

/** Akcja na wiadomościach: zmiana w lokalnej bazie od razu, na serwerze przy synchronizacji. */
function action<A extends unknown[], R>(fn: (...args: A) => R): (_e: unknown, ...args: A) => R {
  return (_e, ...args) => {
    const result = fn(...args)
    schedulePush()
    return result
  }
}

// pliki wybrane w oknie systemowym; renderer dostaje tylko token, nigdy nie podaje ścieżki sam
const pickedFiles = new Map<string, string>()
const OUTBOX_POLL_MS = 15_000

function notifyOutbox(): void {
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send('outbox:changed')
}

function accountWithPassword(accountId: unknown): { account: Account; password: string } {
  const account = Number.isInteger(accountId) ? getAccount(db, accountId as number) : undefined
  if (!account) throw new Error('Wybierz konto, z którego chcesz wysłać wiadomość')
  const password = secrets.get(`account:${account.id}`)
  if (!password) throw new Error(`Brak hasła dla ${account.email}. Usuń i dodaj konto ponownie.`)
  return { account, password }
}

const attachmentsRoot = (): string => join(app.getPath('userData'), 'attachments')

/** Renderer podaje tylko id załącznika; konto, folder i UID bierzemy z bazy. */
function attachmentById(id: unknown): NonNullable<ReturnType<typeof getAttachment>> {
  const attachment = Number.isInteger(id) ? getAttachment(db, id as number) : undefined
  if (!attachment) throw new Error('Nie ma takiego załącznika')
  return attachment
}

function cacheAttachment(attachment: ReturnType<typeof attachmentById>): Promise<string> {
  const { account, password } = accountWithPassword(attachment.accountId)
  return fetchAttachment({ root: attachmentsRoot(), attachment, account, password })
}

/** Szkic z okna "Nowa wiadomość" -> gotowa wiadomość z treścią załączników. */
async function draftToMail(draft: OutgoingDraft): Promise<OutgoingMail> {
  const tokens = Array.isArray(draft.attachments) ? draft.attachments : []
  const attachments = await Promise.all(
    tokens.map(async (token) => {
      const path = pickedFiles.get(token)
      if (!path) throw new Error('Załącznik jest niedostępny, dodaj go ponownie')
      return { filename: basename(path), content: await readFile(path) }
    })
  )
  const mail: OutgoingMail = {
    to: (Array.isArray(draft.to) ? draft.to : []).map((a) => String(a).trim()).filter(Boolean),
    subject: String(draft.subject ?? ''),
    text: String(draft.text ?? ''),
    attachments
  }
  validateMail(mail)
  return mail
}

function releaseFiles(draft: OutgoingDraft): void {
  if (Array.isArray(draft.attachments)) draft.attachments.forEach((t) => pickedFiles.delete(t))
}

/** Wysyła zaplanowane wiadomości, których czas już minął. */
let outboxRunning = false
async function processOutbox(): Promise<void> {
  if (outboxRunning) return
  outboxRunning = true
  try {
    const due = claimDue(db, Date.now())
    if (due.length > 0) notifyOutbox()
    for (const item of due) {
      try {
        const { account, password } = accountWithPassword(item.accountId)
        await sendMail(account, password, item.mail)
        markSent(db, item.id)
      } catch (e) {
        const message = (e as { response?: string }).response || (e as Error).message
        console.error('zaplanowana wysyłka:', message)
        markFailed(db, item.id, message)
      }
      notifyOutbox()
    }
  } finally {
    outboxRunning = false
  }
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    // macOS: bez paska tytułowego, przyciski okna wtapiają się w pasek boczny (przeciąganie: .titlebar-drag)
    ...(process.platform === 'darwin' && {
      titleBarStyle: 'hiddenInset' as const,
      trafficLightPosition: { x: 16, y: 16 }
    }),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  // linki z treści maila (target=_blank w czytniku) otwieramy w przeglądarce, nigdy w aplikacji
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^(https?|mailto):/i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    if (url !== win.webContents.getURL()) e.preventDefault()
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  db = openDb(join(app.getPath('userData'), 'zim.sqlite'))
  secrets = createSecretStore(join(app.getPath('userData'), 'secrets.json'))

  // accountId === null: zunifikowana skrzynka "Wszystko"
  ipcMain.handle('messages:list', (_e, query: MessageQuery) => listMessages(db, query))
  ipcMain.handle('messages:search', (_e, query: { accountId: number | null; text: string }) =>
    searchMessages(db, { accountId: Number.isInteger(query?.accountId) ? query.accountId : null, text: String(query?.text ?? '') })
  )
  ipcMain.handle('messages:get', (_e, id: unknown) => (Number.isInteger(id) ? getMessage(db, id as number) : null))
  ipcMain.handle(
    'messages:read',
    action((ids: unknown, read: boolean) => setRead(db, sanitizeIds(ids), read === true))
  )
  ipcMain.handle(
    'messages:star',
    action((ids: unknown, starred: boolean) => setStarred(db, sanitizeIds(ids), starred === true))
  )
  ipcMain.handle(
    'messages:move',
    action((ids: unknown, folder: Folder) => moveToFolder(db, sanitizeIds(ids), folder))
  )
  ipcMain.handle('messages:spam', action((ids: unknown) => markSpam(db, sanitizeIds(ids))))
  ipcMain.handle('messages:notSpam', action((ids: unknown) => markNotSpam(db, sanitizeIds(ids))))
  ipcMain.handle('messages:deleteForever', action((ids: unknown) => deleteForever(db, sanitizeIds(ids))))

  // tagi są tylko lokalne, więc bez action(): nie ma czego wypychać na serwer
  ipcMain.handle('tags:list', () => listTags(db))
  ipcMain.handle('tags:create', (_e, name: unknown, color: unknown, description: unknown) => {
    const tag = createTag(db, name, color, description)
    classifier.kick() // bez tagów klasyfikator stał; teraz ma z czego wybierać
    return tag
  })
  ipcMain.handle('tags:update', (_e, id: unknown, name: unknown, color: unknown, description: unknown) => {
    if (!Number.isInteger(id)) throw new Error('Nieznany tag')
    return updateTag(db, id as number, name, color, description)
  })
  ipcMain.handle('tags:move', (_e, id: unknown, direction: unknown) => {
    if (!Number.isInteger(id) || (direction !== 'up' && direction !== 'down')) throw new Error('Nieznany tag')
    moveTag(db, id as number, direction)
  })
  ipcMain.handle('tags:delete', (_e, id: unknown) => {
    if (Number.isInteger(id)) deleteTag(db, id as number)
  })
  ipcMain.handle('messages:tag', (_e, ids: unknown, tagId: unknown, on: unknown) => {
    if (!Number.isInteger(tagId)) throw new Error('Nieznany tag')
    setMessageTag(db, sanitizeIds(ids), tagId as number, on === true)
  })

  ipcMain.handle('contacts:list', () => listContacts(db))
  ipcMain.handle('contacts:save', (_e, contact: unknown) => saveContact(db, contact))
  ipcMain.handle('contacts:mail', (_e, id: unknown) => (Number.isInteger(id) ? contactMail(db, id as number) : []))
  ipcMain.handle('contacts:delete', (_e, id: unknown) => {
    if (Number.isInteger(id)) deleteContact(db, id as number)
  })
  // zdjęcie wraca jako data URL (CSP renderera dopuszcza img-src data:), ścieżka nie opuszcza main
  ipcMain.handle('contacts:pickPhoto', async (e): Promise<string | null> => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const options: Electron.OpenDialogOptions = {
      title: 'Wybierz zdjęcie',
      properties: ['openFile'],
      filters: [{ name: 'Obrazy', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }]
    }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    if (result.canceled || !result.filePaths[0]) return null
    const path = result.filePaths[0]
    if ((await stat(path)).size > 1_000_000) throw new Error('Zdjęcie jest za duże (najwyżej 1 MB)')
    const ext = extname(path).slice(1).toLowerCase()
    const mime = ext === 'jpg' ? 'jpeg' : ext
    return `data:image/${mime};base64,${(await readFile(path)).toString('base64')}`
  })

  ipcMain.handle('attachments:open', async (e, id: unknown) => {
    const attachment = attachmentById(id)
    const win = BrowserWindow.fromWebContents(e.sender)
    if (isRisky(attachment.filename)) {
      // pobrane przez ZIM pliki nie mają znacznika kwarantanny, więc system ich nie sprawdzi
      const options: Electron.MessageBoxOptions = {
        type: 'warning',
        buttons: ['Anuluj', 'Otwórz mimo to'],
        defaultId: 0,
        cancelId: 0,
        message: `„${attachment.filename}” może uruchomić program na tym komputerze.`,
        detail: 'Pliki tego typu w wiadomościach bywają złośliwe. Otwieraj je tylko od zaufanych nadawców.'
      }
      const answer = win ? await dialog.showMessageBox(win, options) : await dialog.showMessageBox(options)
      if (answer.response !== 1) return
    }
    const error = await shell.openPath(await cacheAttachment(attachment))
    if (error) throw new Error(error)
  })
  ipcMain.handle('attachments:save', async (e, id: unknown): Promise<boolean> => {
    const attachment = attachmentById(id)
    const win = BrowserWindow.fromWebContents(e.sender)
    const options: Electron.SaveDialogOptions = {
      title: 'Zapisz załącznik',
      defaultPath: join(app.getPath('downloads'), safeFilename(attachment.filename))
    }
    const target = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
    if (target.canceled || !target.filePath) return false
    await copyFile(await cacheAttachment(attachment), target.filePath)
    return true
  })

  ipcMain.handle('compose:pickFiles', async (e): Promise<PickedFile[]> => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const options: Electron.OpenDialogOptions = {
      title: 'Dodaj załączniki',
      properties: ['openFile', 'multiSelections']
    }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    if (result.canceled) return []
    return Promise.all(
      result.filePaths.map(async (path) => {
        const token = randomUUID()
        pickedFiles.set(token, path)
        return { token, name: basename(path), size: (await stat(path)).size }
      })
    )
  })
  ipcMain.handle('compose:send', async (_e, draft: OutgoingDraft) => {
    const { account, password } = accountWithPassword(draft.accountId)
    try {
      await sendMail(account, password, await draftToMail(draft))
    } catch (e) {
      // odpowiedź serwera SMTP (np. "535 Authentication failed") mówi więcej niż sam błąd
      throw new Error((e as { response?: string }).response || (e as Error).message)
    }
    releaseFiles(draft)
  })
  ipcMain.handle('compose:schedule', async (_e, draft: OutgoingDraft, sendAt: unknown) => {
    if (typeof sendAt !== 'number' || !Number.isFinite(sendAt)) throw new Error('Wybierz datę i godzinę')
    if (sendAt < Date.now() - 60_000) throw new Error('Ta godzina już minęła')
    const { account } = accountWithPassword(draft.accountId)
    const id = scheduleMail(db, account.id, await draftToMail(draft), sendAt)
    releaseFiles(draft)
    notifyOutbox()
    return id
  })
  ipcMain.handle('outbox:list', (_e, accountId: number | null) => listScheduled(db, accountId ?? null))
  ipcMain.handle('outbox:cancel', (_e, id: number) => {
    cancelScheduled(db, id)
    notifyOutbox()
  })
  ipcMain.handle('outbox:retry', (_e, id: number) => {
    retryScheduled(db, id)
    notifyOutbox()
    void processOutbox()
  })

  ipcMain.handle('accounts:list', () => listAccounts(db))

  ipcMain.handle('accounts:add', (_e, input: NewAccount & { password: string }) => {
    if (!input.password) throw new Error('Podaj hasło')
    const { password, ...fields } = input
    const account = addAccount(db, fields)
    try {
      secrets.set(`account:${account.id}`, password)
    } catch (e) {
      removeAccount(db, account.id)
      throw e
    }
    startSync(account)
    return account
  })

  ipcMain.handle('accounts:setAlias', (_e, id: number, alias: string | null) =>
    setAccountAlias(db, id, alias)
  )

  ipcMain.handle('accounts:remove', (_e, id: number) => {
    syncing.get(id)?.abort()
    rerun.delete(id)
    syncedOnce.delete(id)
    removeAccount(db, id)
    secrets.delete(`account:${id}`)
  })

  void pruneCache(attachmentsRoot(), CACHE_LIMIT).catch(() => undefined)
  classifier = createClassifier({
    db,
    config: () => getAiConfig(db),
    classify: classifyWithOllama,
    onTagged: notifyTagged,
    onArchived: schedulePush
  })
  ipcMain.handle('ai:status', async () => ({ ...classifier.status(), models: await listModels() }))
  ipcMain.handle('ai:setConfig', (_e, config: unknown) => {
    setAiConfig(db, config)
    classifier.kick()
  })
  // po dodaniu tagów albo zmianie modelu: ostatnie maile tagowane od nowa
  ipcMain.handle('ai:reprocess', () => classifier.reprocess())
  ipcMain.handle('messages:reclassify', async (_e, id: unknown) => {
    if (!Number.isInteger(id)) throw new Error('Nieznana wiadomość')
    await classifier.classifyNow(id as number)
    return getMessage(db, id as number)
  })

  // skrót wiadomości powstaje dopiero po jej otwarciu; kolejka tagowania nie jest wstrzymywana
  const summarizer = createSummarizer({ db, config: () => getAiConfig(db), summarize: summarizeWithOllama })
  ipcMain.handle('messages:summary', (_e, id: unknown, force: unknown) => {
    if (!Number.isInteger(id)) throw new Error('Nieznana wiadomość')
    return summarizer.get(id as number, force === true)
  })

  createWindow()
  // serwer Ollamy startuje razem z aplikacją (tylko gdy asystent jest włączony); dopiero potem tagowanie
  if (getAiConfig(db).enabled) void ensureOllamaRunning().then(() => classifier.kick())
  else classifier.kick()
  // zmiany zrobione w innych klientach (Gmail w przeglądarce, telefon): przy starcie,
  // co minutę i po powrocie do okna
  syncAll()
  setInterval(syncAll, POLL_MS)
  recoverInterrupted(db)
  void processOutbox()
  setInterval(() => void processOutbox(), OUTBOX_POLL_MS)
  app.on('browser-window-focus', syncAll)
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// zamykamy tylko serwer, który uruchomiliśmy sami; cudzy (aplikacja Ollama, brew services) zostaje
app.on('will-quit', stopOllama)

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
