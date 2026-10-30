import type Database from 'better-sqlite3'
import type { Tag } from '@shared/types'

const NAME_MAX = 30
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

function assertFree(db: Database.Database, name: string, exceptId: number | null): void {
  const taken = db
    .prepare('SELECT id FROM tags WHERE lower(name) = lower(?) AND id IS NOT ?')
    .get(name, exceptId) as { id: number } | undefined
  if (taken) throw new Error('Tag o takiej nazwie już istnieje')
}

export function listTags(db: Database.Database): Tag[] {
  return db.prepare('SELECT id, name, color FROM tags ORDER BY lower(name)').all() as Tag[]
}

export function createTag(db: Database.Database, name: unknown, color: unknown): Tag {
  const clean = cleanName(name)
  assertFree(db, clean, null)
  const col = cleanColor(color)
  const id = db.prepare('INSERT INTO tags (name, color) VALUES (?, ?)').run(clean, col).lastInsertRowid
  return { id: Number(id), name: clean, color: col }
}

export function updateTag(db: Database.Database, id: number, name: unknown, color: unknown): Tag {
  const clean = cleanName(name)
  assertFree(db, clean, id)
  const col = cleanColor(color)
  const result = db.prepare('UPDATE tags SET name = ?, color = ? WHERE id = ?').run(clean, col, id)
  if (result.changes === 0) throw new Error('Tag już nie istnieje')
  return { id, name: clean, color: col }
}

/** Usuwa tag razem z jego przypisaniami do wiadomości (ON DELETE CASCADE). */
export function deleteTag(db: Database.Database, id: number): void {
  db.prepare('DELETE FROM tags WHERE id = ?').run(id)
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
        `SELECT mt.message_id AS messageId, t.id, t.name, t.color
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
