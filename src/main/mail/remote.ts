import type Database from 'better-sqlite3'
import type { ImapFlow } from 'imapflow'
import type { Folder } from '@shared/types'
import { folderOf, packUids, pathOf, type ServerFolders } from './folders'

/**
 * Wypychanie zmian z ZIM na serwer. Stan docelowy to kolumny folder/read/starred,
 * a mailbox/server_uid/server_seen/server_flagged opisują, co jest na serwerze.
 * Każda różnica między nimi jest zmianą do wykonania; po sukcesie kolumny serwera
 * się wyrównują, więc nieudana operacja zostanie po prostu powtórzona przy kolejnej synchronizacji.
 */

interface LocalRow {
  id: number
  message_id: string | null
  folder: Folder | 'deleted'
  read: number
  starred: number
  mailbox: string
  server_uid: number | null
  server_seen: number | null
  server_flagged: number | null
}

export async function withMailbox<T>(client: ImapFlow, path: string, fn: () => Promise<T>): Promise<T> {
  const lock = await client.getMailboxLock(path)
  try {
    return await fn()
  } finally {
    lock.release()
  }
}

/** UID wiadomości w otwartym folderze po nagłówku Message-ID */
export async function findByMessageId(client: ImapFlow, messageId: string): Promise<number | null> {
  const found = await client.search({ header: { 'message-id': messageId } }, { uid: true })
  return found && found.length > 0 ? Math.max(...found) : null
}

/**
 * Zapisuje, gdzie wiadomość jest na serwerze. Ten sam (folder, UID) to ta sama wiadomość,
 * więc ewentualny inny wiersz z tą lokalizacją jest nieaktualnym duplikatem.
 */
export function setLocation(
  db: Database.Database,
  accountId: number,
  id: number,
  mailbox: string | null,
  uid: number | null
): void {
  if (mailbox !== null && uid !== null) {
    db.prepare('DELETE FROM messages WHERE account_id = ? AND mailbox = ? AND server_uid = ? AND id != ?').run(
      accountId,
      mailbox,
      uid,
      id
    )
  }
  db.prepare('UPDATE messages SET mailbox = ?, server_uid = ? WHERE id = ?').run(mailbox, uid, id)
}

function groupBy<T, K>(items: T[], key: (item: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>()
  for (const item of items) {
    const k = key(item)
    map.set(k, [...(map.get(k) ?? []), item])
  }
  return map
}

/** Uzupełnia brakujące UID (np. gdy serwer nie zwrócił COPYUID po przeniesieniu). */
async function resolveMissingUids(db: Database.Database, client: ImapFlow, accountId: number): Promise<void> {
  const rows = db
    .prepare(
      `SELECT id, message_id, mailbox FROM messages
       WHERE account_id = ? AND mailbox IS NOT NULL AND server_uid IS NULL`
    )
    .all(accountId) as { id: number; message_id: string | null; mailbox: string }[]
  for (const [mailbox, group] of groupBy(rows, (r) => r.mailbox)) {
    await withMailbox(client, mailbox, async () => {
      for (const row of group) {
        const uid = row.message_id ? await findByMessageId(client, row.message_id) : null
        // nie znaleziono: odszuka ją krok lokalizowania w pozostałych folderach
        setLocation(db, accountId, row.id, uid === null ? null : mailbox, uid)
      }
    })
  }
}

export async function pushChanges(
  db: Database.Database,
  client: ImapFlow,
  accountId: number,
  folders: ServerFolders,
  signal?: AbortSignal
): Promise<void> {
  await resolveMissingUids(db, client, accountId)

  const rows = db
    .prepare(
      `SELECT id, message_id, folder, read, starred, mailbox, server_uid, server_seen, server_flagged
       FROM messages
       WHERE account_id = @accountId AND mailbox IS NOT NULL AND server_uid IS NOT NULL AND (
         folder = 'deleted'
         OR read IS NOT server_seen
         OR (server_flagged IS NOT NULL AND starred != server_flagged)
         OR folder != CASE
              WHEN upper(mailbox) = 'INBOX' THEN 'inbox'
              WHEN mailbox = @trash THEN 'trash'
              WHEN mailbox = @spam THEN 'spam'
              ELSE 'archive' END
       )`
    )
    .all({ accountId, trash: folders.trash, spam: folders.spam }) as LocalRow[]
  if (rows.length === 0) return

  const setSeen = db.prepare('UPDATE messages SET server_seen = ? WHERE id = ?')
  const setFlagged = db.prepare('UPDATE messages SET server_flagged = ? WHERE id = ?')

  for (const [mailbox, group] of groupBy(rows, (r) => r.mailbox)) {
    if (signal?.aborted) return
    await withMailbox(client, mailbox, async () => {
      // 1. flagi, zanim wiadomość zmieni folder (przenoszą się razem z nią)
      const flagOps: [rows: LocalRow[], flag: string, add: boolean, save: Database.Statement][] = [
        [group.filter((r) => r.read === 1 && r.server_seen !== 1), '\\Seen', true, setSeen],
        [group.filter((r) => r.read === 0 && r.server_seen !== 0), '\\Seen', false, setSeen],
        [group.filter((r) => r.server_flagged === 0 && r.starred === 1), '\\Flagged', true, setFlagged],
        [group.filter((r) => r.server_flagged === 1 && r.starred === 0), '\\Flagged', false, setFlagged]
      ]
      for (const [items, flag, add, save] of flagOps) {
        if (items.length === 0) continue
        const range = packUids(items.map((r) => r.server_uid!))
        if (add) await client.messageFlagsAdd(range, [flag], { uid: true })
        else await client.messageFlagsRemove(range, [flag], { uid: true })
        db.transaction(() => items.forEach((r) => save.run(add ? 1 : 0, r.id)))()
      }

      // 2. przeniesienia; trwałe usunięcie idzie najpierw do kosza
      const current = folderOf(folders, mailbox)
      const moving = group.filter((r) => {
        const target = r.folder === 'deleted' ? 'trash' : r.folder
        return target !== current
      })
      const byTarget = groupBy(moving, (r) => pathOf(folders, r.folder === 'deleted' ? 'trash' : r.folder))
      for (const [target, items] of byTarget) {
        const range = packUids(items.map((r) => r.server_uid!))
        // Gmail: usunięcie z All Mail kasuje wiadomość ze wszystkich etykiet, więc tylko kopiujemy
        // (kopia do INBOX dodaje etykietę, do Kosza/Spamu przenosi)
        const result =
          folders.gmail && mailbox === folders.archive
            ? await client.messageCopy(range, target, { uid: true })
            : await client.messageMove(range, target, { uid: true })
        if (result === false) throw new Error(`Nie udało się przenieść wiadomości do ${target}`)
        db.transaction(() =>
          items.forEach((r) => setLocation(db, accountId, r.id, target, result.uidMap?.get(r.server_uid!) ?? null))
        )()
      }
    })
  }

  await deleteFromTrash(db, client, accountId, folders)
}

/** Usuwa na zawsze wiadomości oznaczone 'deleted', które są już w koszu na serwerze. */
async function deleteFromTrash(
  db: Database.Database,
  client: ImapFlow,
  accountId: number,
  folders: ServerFolders
): Promise<void> {
  await resolveMissingUids(db, client, accountId)
  const rows = db
    .prepare(
      `SELECT id, server_uid FROM messages
       WHERE account_id = ? AND folder = 'deleted' AND mailbox = ? AND server_uid IS NOT NULL`
    )
    .all(accountId, folders.trash) as { id: number; server_uid: number }[]
  if (rows.length === 0) return
  await withMailbox(client, folders.trash, async () => {
    const ok = await client.messageDelete(packUids(rows.map((r) => r.server_uid)), { uid: true })
    if (!ok) throw new Error('Nie udało się usunąć wiadomości z kosza')
  })
  const remove = db.prepare('DELETE FROM messages WHERE id = ?')
  db.transaction(() => rows.forEach((r) => remove.run(r.id)))()
}
