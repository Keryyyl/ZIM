import type Database from 'better-sqlite3'
import type { Tag } from '@shared/types'
import { SYSTEM_TAGS } from '@shared/priority'

const NAME_MAX = 30
const TAG_COLUMNS = 'id, name, color, description, system_key AS system'
const DESCRIPTION_MAX = 200
const COLOR = /^#[0-9a-f]{6}$/i

function cleanName(name: unknown): string {
  const value = typeof name === 'string' ? name.trim().replace(/\s+/g, ' ') : ''
  if (!value) throw new Error('Podaj nazwę tagu')
  if (value.length > NAME_MAX) throw new Error(`Nazwa tagu może mieć najwyżej ${NAME_MAX} znaków`)
  return value
}

function cleanColor(color: unknown): string | null {
  return typeof color === 'string' && COLOR.test(color) ? color.toLowerCase() : null
}

function cleanDescription(description: unknown): string {
  const value = typeof description === 'string' ? description.trim().replace(/\s+/g, ' ') : ''
  if (value.length > DESCRIPTION_MAX) throw new Error(`Opis tagu może mieć najwyżej ${DESCRIPTION_MAX} znaków`)
  return value
}

function assertFree(db: Database.Database, name: string, exceptId: number | null): void {
  const taken = db
    .prepare('SELECT id FROM tags WHERE lower(name) = lower(?) AND id IS NOT ?')
    .get(name, exceptId) as { id: number } | undefined
  if (taken) throw new Error('Tag o takiej nazwie już istnieje')
}

export function listTags(db: Database.Database): Tag[] {
  return db.prepare(`SELECT ${TAG_COLUMNS} FROM tags ORDER BY position, id`).all() as Tag[]
}

/** Przesuwa tag o jedno miejsce w górę lub w dół listy (kolejność z Ustawień i paska bocznego). */
export function moveTag(db: Database.Database, id: number, direction: 'up' | 'down'): void {
  db.transaction(() => {
    const ids = (db.prepare('SELECT id FROM tags ORDER BY position, id').all() as { id: number }[]).map((r) => r.id)
    const from = ids.indexOf(id)
    const to = direction === 'up' ? from - 1 : from + 1
    if (from < 0 || to < 0 || to >= ids.length) return
    ;[ids[from], ids[to]] = [ids[to], ids[from]]
    const set = db.prepare('UPDATE tags SET position = ? WHERE id = ?')
    ids.forEach((tagId, i) => set.run(i + 1, tagId))
  })()
}

export function createTag(db: Database.Database, name: unknown, color: unknown, description: unknown = ''): Tag {
  const clean = cleanName(name)
  assertFree(db, clean, null)
  const col = cleanColor(color)
  const desc = cleanDescription(description)
  const id = db
    .prepare('INSERT INTO tags (name, color, description, position) VALUES (?, ?, ?, (SELECT COALESCE(MAX(position), 0) + 1 FROM tags))')
    .run(clean, col, desc).lastInsertRowid
  return { id: Number(id), name: clean, color: col, description: desc, system: null }
}

/** Bez `description` (undefined) opis zostaje taki, jaki był. */
export function updateTag(db: Database.Database, id: number, name: unknown, color: unknown, description?: unknown): Tag {
  const clean = cleanName(name)
  assertFree(db, clean, id)
  const col = cleanColor(color)
  const result =
    description === undefined
      ? db.prepare('UPDATE tags SET name = ?, color = ? WHERE id = ?').run(clean, col, id)
      : db
          .prepare('UPDATE tags SET name = ?, color = ?, description = ? WHERE id = ?')
          .run(clean, col, cleanDescription(description), id)
  if (result.changes === 0) throw new Error('Tag już nie istnieje')
  return db.prepare(`SELECT ${TAG_COLUMNS} FROM tags WHERE id = ?`).get(id) as Tag
}

/** Usuwa tag razem z jego przypisaniami do wiadomości (ON DELETE CASCADE). Wbudowanych tagów ważności nie usuwa. */
export function deleteTag(db: Database.Database, id: number): void {
  const tag = db.prepare('SELECT system_key FROM tags WHERE id = ?').get(id) as { system_key: string | null } | undefined
  if (tag?.system_key) throw new Error('Tag wbudowany: można zmienić jego nazwę, kolor i opis, ale nie usunąć')
  db.prepare('DELETE FROM tags WHERE id = ?').run(id)
}

/**
 * Wbudowane tagi ważności istnieją zawsze. Przy pierwszym uruchomieniu powstają z domyślnymi opisami;
 * w istniejącej bazie przejmujemy tag o tej samej nazwie (z jego kolorem i opisem), a brakujące tworzymy.
 */
export function ensureSystemTags(db: Database.Database): void {
  db.transaction(() => {
    for (const def of SYSTEM_TAGS) {
      if (db.prepare('SELECT 1 FROM tags WHERE system_key = ?').get(def.key)) continue
      const same = db.prepare('SELECT id FROM tags WHERE lower(name) = lower(?) AND system_key IS NULL').get(def.name) as
        | { id: number }
        | undefined
      if (same) {
        db.prepare(
          `UPDATE tags SET system_key = ?, color = COALESCE(color, ?),
             description = CASE WHEN description = '' THEN ? ELSE description END WHERE id = ?`
        ).run(def.key, def.color, def.description, same.id)
      } else {
        db.prepare(
          `INSERT INTO tags (name, color, description, position, system_key)
           VALUES (?, ?, ?, (SELECT COALESCE(MAX(position), 0) + 1 FROM tags), ?)`
        ).run(def.name, def.color, def.description, def.key)
      }
    }
  })()
}

/** Dodaje albo zdejmuje istniejący tag; tagów nie da się tu tworzyć. */
export function setMessageTag(db: Database.Database, messageIds: number[], tagId: number, on: boolean): void {
  if (!db.prepare('SELECT 1 FROM tags WHERE id = ?').get(tagId)) throw new Error('Tag już nie istnieje')
  db.transaction(() => {
    const stmt = on
      ? db.prepare("INSERT OR IGNORE INTO message_tags (message_id, tag_id, source) VALUES (?, ?, 'manual')")
      : db.prepare('DELETE FROM message_tags WHERE message_id = ? AND tag_id = ?')
    for (const id of messageIds) stmt.run(id, tagId)
  })()
}

/** Tagi podanych wiadomości, posortowane po nazwie. */
export function tagsByMessage(db: Database.Database, ids: number[]): Map<number, Tag[]> {
  const result = new Map<number, Tag[]>()
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500)
    const rows = db
      .prepare(
        `SELECT mt.message_id AS messageId, t.id, t.name, t.color, t.description, t.system_key AS system
         FROM message_tags mt JOIN tags t ON t.id = mt.tag_id
         WHERE mt.message_id IN (${chunk.map(() => '?').join(', ')})
         ORDER BY lower(t.name)`
      )
      .all(...chunk) as (Tag & { messageId: number })[]
    for (const { messageId, ...tag } of rows) {
      const list = result.get(messageId)
      if (list) list.push(tag)
      else result.set(messageId, [tag])
    }
  }
  return result
}
