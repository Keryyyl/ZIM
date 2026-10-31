import type Database from 'better-sqlite3'
import { ImapFlow } from 'imapflow'
import { simpleParser, type AddressObject } from 'mailparser'
import type { Account, Folder } from '@shared/types'
import { saveAttachments, uncheckedMessages } from '../db/attachments'
import { extractEmail } from './address'
import { collectAttachments, type AttachmentInfo } from './attachments'
import { DEFAULT_PATHS, folderOf, packUids, pickFolders, type ServerFolders } from './folders'
import { findByMessageId, pushChanges, setLocation, withMailbox } from './remote'

const INBOX = 'INBOX'
const BATCH = 25
const SNIPPET_WORDS = 30

export interface SyncProgress {
  done: number
  total: number
}

export interface SyncOptions {
  password: string
  signal?: AbortSignal
  /** Wołane po każdej zapisanej paczce, żeby UI mógł odświeżyć listę. */
  onProgress?: (p: SyncProgress) => void
}

/** Pierwsze słowa treści, bez cytatów z poprzednich wiadomości. */
export function makeSnippet(text: string, words = SNIPPET_WORDS): string {
  const lines = text.split(/\r?\n/).filter((l) => !l.trimStart().startsWith('>'))
  const all = lines.join(' ').split(/\s+/).filter(Boolean)
  const head = all.slice(0, words).join(' ')
  return all.length > words ? `${head}…` : head
}

function formatAddress(a: AddressObject | AddressObject[] | undefined): string {
  const list = (Array.isArray(a) ? a : a ? [a] : []).flatMap((x) => x.value)
  return list
    .map((v) => (v.name ? `${v.name} <${v.address ?? ''}>` : (v.address ?? '')))
    .join(', ')
}

// TODO: reguły (rules/engine.ts) i klasyfikator LLM po zapisaniu, IDLE na INBOX
/**
 * Dwukierunkowa synchronizacja konta:
 * 1. wypchnięcie zmian z ZIM (foldery, przeczytane, gwiazdki, usunięcia),
 * 2. pobranie nowych wiadomości z INBOX,
 * 3. pobranie flag i wykrycie wiadomości przeniesionych/usuniętych na serwerze,
 * 4. ponowne wypchnięcie (np. nowe maile od zablokowanych nadawców idą do spamu).
 */
export async function syncAccount(
  db: Database.Database,
  account: Account,
  { password, signal, onProgress }: SyncOptions
): Promise<void> {
  const client = new ImapFlow({
    host: account.imapHost,
    port: account.imapPort,
    secure: account.imapPort === 993,
    auth: { user: account.username, pass: password },
    logger: false
  })
  const onAbort = (): void => void client.close()
  signal?.addEventListener('abort', onAbort)

  try {
    await client.connect()
    const { folders, available } = await discoverFolders(client)
    await pushChanges(db, client, account.id, folders, signal)
    if (signal?.aborted) return

    const vanished: Vanished[] = []
    const watched = db
      .prepare('SELECT DISTINCT mailbox FROM messages WHERE account_id = ? AND mailbox IS NOT NULL')
      .all(account.id) as { mailbox: string }[]
    const mailboxes = [INBOX, ...watched.map((w) => w.mailbox).filter((m) => m.toUpperCase() !== INBOX)]
    for (const mailbox of mailboxes) {
      if (signal?.aborted) return
      await withMailbox(client, mailbox, async () => {
        checkUidValidity(db, client, account.id, mailbox)
        if (mailbox === INBOX) await downloadNew(db, client, account.id, { signal, onProgress })
        vanished.push(...(await refreshFlags(db, client, account.id, mailbox, folders)))
        if (!signal?.aborted) await backfillAttachments(db, client, account.id, mailbox)
      })
    }
    if (signal?.aborted) return
    await locateMoved(db, client, account.id, folders, available, vanished)
    await pushChanges(db, client, account.id, folders, signal)
    await client.logout()
  } catch (e) {
    client.close()
    throw e
  } finally {
    signal?.removeEventListener('abort', onAbort)
  }
}

async function discoverFolders(client: ImapFlow): Promise<{ folders: ServerFolders; available: Set<string> }> {
  const gmail = client.capabilities.has('X-GM-EXT-1')
  let list = await client.list()
  const { folders, missing } = pickFolders(list, gmail)
  if (missing.length > 0) {
    // serwer bez folderu archiwum/spamu/kosza: zakładamy go, jak robią inne klienty
    for (const key of missing) await client.mailboxCreate(DEFAULT_PATHS[key]).catch(() => undefined)
    list = await client.list()
  }
  return { folders, available: new Set(list.map((m) => m.path)) }
}

/** Zmiana UIDVALIDITY = stare UID w tym folderze nic nie znaczą; wiadomości odszukamy po Message-ID. */
function checkUidValidity(db: Database.Database, client: ImapFlow, accountId: number, mailbox: string): void {
  const box = client.mailbox
  if (!box) throw new Error(`Nie udało się otworzyć ${mailbox}`)
  const uidValidity = String(box.uidValidity)
  const state = db
    .prepare('SELECT uid_validity FROM sync_state WHERE account_id = ? AND mailbox = ?')
    .get(accountId, mailbox) as { uid_validity: string } | undefined
  if (state && state.uid_validity !== uidValidity) {
    db.transaction(() => {
      // uid = -id: stara kolumna uid ma UNIQUE, a nowe UID z INBOX zaczną się od początku
      db.prepare(
        'UPDATE messages SET mailbox = NULL, server_uid = NULL, uid = -id WHERE account_id = ? AND mailbox = ?'
      ).run(accountId, mailbox)
      db.prepare('UPDATE sync_state SET last_uid = 0 WHERE account_id = ? AND mailbox = ?').run(accountId, mailbox)
    })()
  }
  db.prepare(
    `INSERT INTO sync_state (account_id, mailbox, uid_validity, last_uid) VALUES (?, ?, ?, 0)
     ON CONFLICT (account_id, mailbox) DO UPDATE SET uid_validity = excluded.uid_validity`
  ).run(accountId, mailbox, uidValidity)
}

/** Pobiera nowe wiadomości z otwartego INBOX, od najnowszych, paczkami. */
async function downloadNew(
  db: Database.Database,
  client: ImapFlow,
  accountId: number,
  { signal, onProgress }: Pick<SyncOptions, 'signal' | 'onProgress'>
): Promise<void> {
  const { last_uid: lastUid } = db
    .prepare('SELECT last_uid FROM sync_state WHERE account_id = ? AND mailbox = ?')
    .get(accountId, INBOX) as { last_uid: number }

  const found = (await client.search({ uid: `${lastUid + 1}:*` }, { uid: true })) || []
  // "n:*" zwraca zawsze ostatnią wiadomość, nawet gdy jej UID < n
  const existing = new Set(
    (
      db.prepare('SELECT server_uid FROM messages WHERE account_id = ? AND mailbox = ?').all(accountId, INBOX) as {
        server_uid: number
      }[]
    ).map((r) => r.server_uid)
  )
  const uids = found.filter((u) => u > lastUid && !existing.has(u)).sort((a, b) => b - a)
  const total = uids.length
  if (total > 0) onProgress?.({ done: 0, total })

  const insert = db.prepare(
    `INSERT OR IGNORE INTO messages
       (account_id, uid, message_id, thread_id, from_addr, from_email, to_addr, subject, date,
        snippet, body_text, body_html, bulk, read, starred, folder, mailbox, server_uid, server_seen, server_flagged)
     VALUES (@accountId, @uid, @messageId, @threadId, @from, @fromEmail, @to, @subject, @date,
        @snippet, @bodyText, @bodyHtml, @bulk, @seen, @flagged,
        -- nadawca oznaczony wcześniej jako spam; przeniesienie na serwerze zrobi pushChanges
        CASE WHEN EXISTS (SELECT 1 FROM spam_senders WHERE email = @fromEmail) THEN 'spam' ELSE 'inbox' END,
        'INBOX', @uid, @seen, @flagged)`
  )
  // wiadomość, którą już mamy, ale zgubiliśmy jej położenie (np. po zmianie UIDVALIDITY)
  const lost = db.prepare(
    `SELECT id FROM messages WHERE account_id = ? AND message_id = ? AND mailbox IS NULL AND folder != 'deleted'`
  )
  const relocate = db.prepare(
    `UPDATE messages SET folder = 'inbox', read = @seen, starred = @flagged,
       server_seen = @seen, server_flagged = @flagged WHERE id = @id`
  )
  // załączniki zapisujemy tylko jako metadane z BODYSTRUCTURE; treść pobieramy dopiero na żądanie
  const attachmentsByUid = new Map<number, AttachmentInfo[]>()
  const save = db.transaction((rows: Record<string, unknown>[]) => {
    for (const row of rows) {
      const match = row.messageId ? (lost.get(accountId, row.messageId) as { id: number } | undefined) : undefined
      if (match) {
        setLocation(db, accountId, match.id, INBOX, row.uid as number)
        relocate.run({ id: match.id, seen: row.seen, flagged: row.flagged })
      } else {
        const inserted = insert.run(row)
        const attachments = attachmentsByUid.get(row.uid as number)
        if (inserted.changes > 0 && attachments) saveAttachments(db, Number(inserted.lastInsertRowid), attachments)
      }
    }
  })

  for (let i = 0; i < uids.length; i += BATCH) {
    if (signal?.aborted) return
    const chunk = uids.slice(i, i + BATCH)
    const rows: Record<string, unknown>[] = []
    attachmentsByUid.clear()
    for await (const msg of client.fetch(
      packUids(chunk),
      { uid: true, flags: true, internalDate: true, source: true, bodyStructure: true },
      { uid: true }
    )) {
      if (!msg.source) continue
      if (msg.bodyStructure) attachmentsByUid.set(msg.uid, collectAttachments(msg.bodyStructure))
      const parsed = await simpleParser(msg.source)
      const bodyText = parsed.text ?? ''
      const references = parsed.references
      const from = formatAddress(parsed.from)
      rows.push({
        accountId,
        uid: msg.uid,
        messageId: parsed.messageId ?? null,
        threadId: (Array.isArray(references) ? references[0] : references) ?? parsed.messageId ?? null,
        from,
        fromEmail: extractEmail(from),
        to: formatAddress(parsed.to),
        subject: parsed.subject ?? '',
        date: (parsed.date ?? new Date(msg.internalDate ?? Date.now())).getTime(),
        snippet: makeSnippet(bodyText),
        bodyText,
        bodyHtml: parsed.html || null,
        bulk: parsed.headers.has('list-unsubscribe') ? 1 : 0,
        seen: msg.flags?.has('\\Seen') ? 1 : 0,
        flagged: msg.flags?.has('\\Flagged') ? 1 : 0
      })
    }
    save(rows)
    onProgress?.({ done: Math.min(i + BATCH, total), total })
  }

  // stan zapisujemy dopiero po pełnym przebiegu; przerwany sync dokończy się następnym razem
  const maxUid = found.reduce((m, u) => Math.max(m, u), lastUid)
  db.prepare('UPDATE sync_state SET last_uid = ? WHERE account_id = ? AND mailbox = ?').run(maxUid, accountId, INBOX)
}

const BACKFILL_BATCH = 500

/**
 * Wiadomości pobrane przed obsługą załączników nie mają zapisanych metadanych.
 * Pobieramy tylko BODYSTRUCTURE (bez treści), po kilkaset na synchronizację na folder.
 */
async function backfillAttachments(
  db: Database.Database,
  client: ImapFlow,
  accountId: number,
  mailbox: string
): Promise<void> {
  const pending = uncheckedMessages(db, accountId, mailbox, BACKFILL_BATCH)
  if (pending.length === 0) return
  const idByUid = new Map(pending.map((p) => [p.serverUid, p.id]))
  const found: { id: number; attachments: AttachmentInfo[] }[] = []
  for await (const msg of client.fetch(packUids([...idByUid.keys()]), { uid: true, bodyStructure: true }, { uid: true })) {
    const id = idByUid.get(msg.uid)
    if (id !== undefined && msg.bodyStructure) found.push({ id, attachments: collectAttachments(msg.bodyStructure) })
  }
  db.transaction(() => found.forEach((f) => saveAttachments(db, f.id, f.attachments)))()
}

interface Vanished {
  id: number
  messageId: string | null
  from: Folder
}

/**
 * Przeczytane/gwiazdki zmienione na serwerze przyjmujemy, o ile w ZIM nie ma
 * niewypchniętej zmiany (read === server_seen). Zwraca wiadomości, których już
 * nie ma w tym folderze na serwerze.
 */
async function refreshFlags(
  db: Database.Database,
  client: ImapFlow,
  accountId: number,
  mailbox: string,
  folders: ServerFolders
): Promise<Vanished[]> {
  const known = db
    .prepare(
      `SELECT id, message_id, server_uid FROM messages
       WHERE account_id = ? AND mailbox = ? AND server_uid IS NOT NULL`
    )
    .all(accountId, mailbox) as { id: number; message_id: string | null; server_uid: number }[]
  if (known.length === 0) return []

  const update = db.prepare(
    `UPDATE messages SET
       read = CASE WHEN server_seen IS NULL OR read = server_seen THEN @seen ELSE read END,
       -- NULL = gwiazdki z serwera jeszcze nie znamy (dane sprzed synchronizacji): scalamy
       starred = CASE WHEN server_flagged IS NULL THEN max(starred, @flagged)
                      WHEN starred = server_flagged THEN @flagged ELSE starred END,
       server_seen = @seen, server_flagged = @flagged
     WHERE id = @id`
  )
  const byUid = new Map(known.map((k) => [k.server_uid, k]))
  const seen = new Set<number>()
  const updates: { id: number; seen: number; flagged: number }[] = []
  for await (const msg of client.fetch(packUids([...byUid.keys()]), { uid: true, flags: true }, { uid: true })) {
    const row = byUid.get(msg.uid)
    if (!row) continue
    seen.add(msg.uid)
    updates.push({
      id: row.id,
      seen: msg.flags?.has('\\Seen') ? 1 : 0,
      flagged: msg.flags?.has('\\Flagged') ? 1 : 0
    })
  }
  db.transaction(() => updates.forEach((u) => update.run(u)))()

  const from = folderOf(folders, mailbox)
  return known
    .filter((k) => !seen.has(k.server_uid))
    .map((k) => ({ id: k.id, messageId: k.message_id, from }))
}

/**
 * Wiadomości, które zniknęły z folderu (przeniesione lub usunięte w innym kliencie),
 * szukamy po Message-ID w pozostałych folderach. Kolejność ma znaczenie w Gmailu:
 * All Mail (archiwum) zawiera też INBOX, więc sprawdzamy je na końcu.
 */
async function locateMoved(
  db: Database.Database,
  client: ImapFlow,
  accountId: number,
  folders: ServerFolders,
  available: Set<string>,
  vanished: Vanished[]
): Promise<void> {
  const remove = db.prepare('DELETE FROM messages WHERE id = ?')
  db.transaction(() => {
    for (const v of vanished) {
      setLocation(db, accountId, v.id, null, null)
      if (v.messageId) continue
      // bez Message-ID nie odszukamy; z INBOX najpewniej zarchiwizowana, z innych folderów usunięta
      if (v.from === 'inbox') db.prepare("UPDATE messages SET folder = 'archive' WHERE id = ?").run(v.id)
      else remove.run(v.id)
    }
  })()

  // także te zgubione wcześniej (np. przerwana synchronizacja, zmiana UIDVALIDITY)
  let pending = db
    .prepare(
      `SELECT id, message_id FROM messages
       WHERE account_id = ? AND mailbox IS NULL AND message_id IS NOT NULL`
    )
    .all(accountId) as { id: number; message_id: string }[]
  if (pending.length === 0) return

  const adopt = db.prepare(
    `UPDATE messages SET folder = CASE WHEN folder = 'deleted' THEN 'deleted' ELSE @folder END,
       read = @seen, starred = @flagged, server_seen = @seen, server_flagged = @flagged
     WHERE id = @id`
  )
  const order: Folder[] = ['trash', 'spam', 'inbox', 'archive']
  for (const folder of order) {
    if (pending.length === 0) break
    const path = folders[folder]
    // brak folderu na serwerze (nie udało się go założyć): szukamy w pozostałych
    if (path !== INBOX && !available.has(path)) continue
    const found: { id: number; uid: number; seen: number; flagged: number }[] = []
    await withMailbox(client, path, async () => {
      for (const row of pending) {
        const uid = await findByMessageId(client, row.message_id)
        if (uid === null) continue
        const msg = await client.fetchOne(String(uid), { uid: true, flags: true }, { uid: true })
        found.push({
          id: row.id,
          uid,
          seen: msg && msg.flags?.has('\\Seen') ? 1 : 0,
          flagged: msg && msg.flags?.has('\\Flagged') ? 1 : 0
        })
      }
    })
    db.transaction(() =>
      found.forEach((f) => {
        setLocation(db, accountId, f.id, path, f.uid)
        adopt.run({ id: f.id, folder, seen: f.seen, flagged: f.flagged })
      })
    )()
    const located = new Set(found.map((f) => f.id))
    pending = pending.filter((p) => !located.has(p.id))
  }

  // nie ma jej w żadnym folderze: usunięta na serwerze
  db.transaction(() => pending.forEach((p) => remove.run(p.id)))()
}
