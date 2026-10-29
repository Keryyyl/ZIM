import { ImapFlow } from 'imapflow'
import { createWriteStream } from 'fs'
import { mkdir, readdir, rename, rm, rmdir, stat, utimes } from 'fs/promises'
import { dirname, join } from 'path'
import { pipeline } from 'stream/promises'
import type { Account } from '@shared/types'
import type { AttachmentLocation } from '../db/attachments'
import { safeFilename } from './attachments'
import { withMailbox } from './remote'

/**
 * Cache pobranych załączników. To kopia robocza, którą zawsze da się odtworzyć z serwera,
 * więc starsze pliki (wg ostatniego użycia) są usuwane po przekroczeniu limitu.
 */
export const CACHE_LIMIT = 2 * 1024 ** 3

export function cachePath(root: string, a: AttachmentLocation): string {
  return join(root, String(a.accountId), String(a.messageId), `${a.id}-${safeFilename(a.filename)}`)
}

interface FetchOptions {
  root: string
  attachment: AttachmentLocation
  account: Account
  password: string
}

// dwa kliknięcia w ten sam załącznik czekają na jedno pobranie
const inFlight = new Map<number, Promise<string>>()

/** Zwraca ścieżkę pliku w cache; jeśli go nie ma, pobiera z serwera tylko tę jedną część MIME. */
export function fetchAttachment(options: FetchOptions): Promise<string> {
  const id = options.attachment.id
  let job = inFlight.get(id)
  if (!job) {
    job = download(options).finally(() => inFlight.delete(id))
    inFlight.set(id, job)
  }
  return job
}

async function download({ root, attachment, account, password }: FetchOptions): Promise<string> {
  const target = cachePath(root, attachment)
  if (await stat(target).then(() => true, () => false)) {
    const now = new Date()
    await utimes(target, now, now) // ostatnie użycie, dla usuwania najstarszych
    return target
  }
  // położenie jest nieznane, gdy sync właśnie szuka przeniesionej wiadomości
  if (!attachment.mailbox || attachment.serverUid === null) {
    throw new Error('Wiadomość jest właśnie synchronizowana, spróbuj za chwilę')
  }

  await mkdir(dirname(target), { recursive: true })
  const temp = `${target}.part`
  const client = new ImapFlow({
    host: account.imapHost,
    port: account.imapPort,
    secure: account.imapPort === 993,
    auth: { user: account.username, pass: password },
    logger: false
  })
  try {
    await client.connect()
    await withMailbox(client, attachment.mailbox, async () => {
      const part = await client.download(String(attachment.serverUid), attachment.part, { uid: true })
      if (!part?.content) throw new Error('Nie znaleziono załącznika na serwerze')
      await pipeline(part.content, createWriteStream(temp))
    })
    await rename(temp, target)
    await client.logout()
  } catch (e) {
    await rm(temp, { force: true })
    client.close()
    throw e
  }
  await pruneCache(root, CACHE_LIMIT).catch(() => undefined)
  return target
}

/** Usuwa najdawniej używane pliki, aż cache zmieści się w 80% limitu. */
export async function pruneCache(root: string, limit: number): Promise<void> {
  const files: { path: string; size: number; used: number }[] = []
  const walk = async (dir: string): Promise<void> => {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(path)
      } else if (entry.isFile()) {
        const info = await stat(path).catch(() => null)
        if (info) files.push({ path, size: info.size, used: info.mtimeMs })
      }
    }
  }
  await walk(root)

  let total = files.reduce((sum, f) => sum + f.size, 0)
  if (total <= limit) return
  files.sort((a, b) => a.used - b.used)
  for (const file of files) {
    if (total <= limit * 0.8) break
    await rm(file.path, { force: true })
    total -= file.size
    await rmdir(dirname(file.path)).catch(() => undefined) // tylko jeśli pusty
  }
}
