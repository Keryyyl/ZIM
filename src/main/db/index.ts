import Database from 'better-sqlite3'
import { extractEmail } from '../mail/address'
import { guessSmtp } from '@shared/smtp'

const SCHEMA = `
CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  alias TEXT,
  imap_host TEXT NOT NULL,
  imap_port INTEGER NOT NULL DEFAULT 993,
  smtp_host TEXT,
  smtp_port INTEGER,
  username TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  uid INTEGER NOT NULL,
  message_id TEXT,
  thread_id TEXT,
  from_addr TEXT NOT NULL,
  to_addr TEXT NOT NULL,
  subject TEXT NOT NULL,
  date INTEGER NOT NULL,
  snippet TEXT NOT NULL DEFAULT '',
  body_text TEXT NOT NULL DEFAULT '',
  body_html TEXT,
  read INTEGER NOT NULL DEFAULT 0,
  priority TEXT NOT NULL DEFAULT 'normal',
  from_email TEXT, -- znormalizowany adres nadawcy, do blokowania spamu
  -- stan docelowy (to, co widzi użytkownik); synchronizacja wypycha go na serwer
  folder TEXT NOT NULL DEFAULT 'inbox', -- inbox | archive | spam | trash | deleted (do usunięcia z serwera)
  starred INTEGER NOT NULL DEFAULT 0,
  -- gdzie wiadomość jest teraz na serwerze; NULL = nieznane, do odszukania po Message-ID
  mailbox TEXT,
  server_uid INTEGER,
  -- flagi ostatnio widziane na serwerze; różnica z read/starred = zmiana do wypchnięcia
  server_seen INTEGER,
  server_flagged INTEGER,
  -- 0 = załączników z BODYSTRUCTURE jeszcze nie zapisaliśmy (wiadomości sprzed ich obsługi)
  attachments_checked INTEGER NOT NULL DEFAULT 0,
  UNIQUE (account_id, uid)
);
CREATE INDEX IF NOT EXISTS idx_messages_date ON messages(date DESC);
CREATE INDEX IF NOT EXISTS idx_messages_message_id ON messages(message_id);

CREATE TABLE IF NOT EXISTS tags (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  color TEXT
);

CREATE TABLE IF NOT EXISTS message_tags (
  message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  source TEXT NOT NULL DEFAULT 'rule', -- rule | llm | manual
  PRIMARY KEY (message_id, tag_id)
);

CREATE TABLE IF NOT EXISTS contacts (
  id INTEGER PRIMARY KEY,
  photo TEXT, -- data URL (zdjęcie zostaje lokalnie, w bazie)
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  city TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  services TEXT NOT NULL DEFAULT '[]' -- JSON: [{ service, username }]
);

CREATE TABLE IF NOT EXISTS rules (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  definition TEXT NOT NULL, -- JSON: match, conditions, addTags, setPriority
  enabled INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS views (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  definition TEXT NOT NULL, -- JSON: includeTags, excludeTags, priority
  position INTEGER NOT NULL DEFAULT 0
);

CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
  subject, from_addr, body_text, content='messages', content_rowid='id'
);
CREATE TRIGGER IF NOT EXISTS messages_fts_ai AFTER INSERT ON messages BEGIN
  INSERT INTO messages_fts(rowid, subject, from_addr, body_text)
  VALUES (new.id, new.subject, new.from_addr, new.body_text);
END;
CREATE TRIGGER IF NOT EXISTS messages_fts_ad AFTER DELETE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, subject, from_addr, body_text)
  VALUES ('delete', old.id, old.subject, old.from_addr, old.body_text);
END;

-- nadawcy oznaczeni jako spam; ich nowe wiadomości od razu trafiają do folderu spam
CREATE TABLE IF NOT EXISTS spam_senders (
  email TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL
);

-- poczta do wysłania o zadanej godzinie ("Wyślij o"); wysyła ją ZIM, gdy jest uruchomiony
CREATE TABLE IF NOT EXISTS outbox (
  id INTEGER PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  to_addrs TEXT NOT NULL, -- JSON: string[]
  subject TEXT NOT NULL,
  body_text TEXT NOT NULL,
  send_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled', -- scheduled | sending | error
  error TEXT,
  created_at INTEGER NOT NULL
);
-- treść załączników kopiujemy przy planowaniu: plik na dysku mógł zostać przeniesiony
CREATE TABLE IF NOT EXISTS outbox_attachments (
  id INTEGER PRIMARY KEY,
  outbox_id INTEGER NOT NULL REFERENCES outbox(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  data BLOB NOT NULL
);

-- metadane załączników odebranych wiadomości; treść pobieramy z serwera dopiero na żądanie
CREATE TABLE IF NOT EXISTS attachments (
  id INTEGER PRIMARY KEY,
  message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  part TEXT NOT NULL, -- numer części MIME na serwerze
  filename TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  content_id TEXT,
  inline INTEGER NOT NULL DEFAULT 0,
  UNIQUE (message_id, part)
);

-- stan synchronizacji per skrzynka; zmiana UIDVALIDITY = pobranie od nowa
CREATE TABLE IF NOT EXISTS sync_state (
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  mailbox TEXT NOT NULL,
  uid_validity TEXT NOT NULL,
  last_uid INTEGER NOT NULL,
  PRIMARY KEY (account_id, mailbox)
);
`

export function openDb(path: string): Database.Database {
  const db = new Database(path)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.exec(SCHEMA)
  migrate(db)
  return db
}

/** Kolumny dodane po pierwszej wersji schematu (CREATE IF NOT EXISTS ich nie doda). */
function migrate(db: Database.Database): void {
  const columns = (db.prepare('PRAGMA table_info(accounts)').all() as { name: string }[]).map((c) => c.name)
  if (!columns.includes('alias')) db.exec('ALTER TABLE accounts ADD COLUMN alias TEXT')
  if (!columns.includes('smtp_host')) {
    db.exec('ALTER TABLE accounts ADD COLUMN smtp_host TEXT; ALTER TABLE accounts ADD COLUMN smtp_port INTEGER')
  }
  // konta dodane przed wysyłką: SMTP zgadujemy z serwera IMAP
  const noSmtp = db.prepare('SELECT id, imap_host FROM accounts WHERE smtp_host IS NULL').all() as {
    id: number
    imap_host: string
  }[]
  const setSmtp = db.prepare('UPDATE accounts SET smtp_host = ?, smtp_port = ? WHERE id = ?')
  for (const a of noSmtp) {
    const smtp = guessSmtp(a.imap_host)
    setSmtp.run(smtp.host, smtp.port, a.id)
  }

  const msgColumns = (db.prepare('PRAGMA table_info(messages)').all() as { name: string }[]).map((c) => c.name)
  if (!msgColumns.includes('folder')) db.exec("ALTER TABLE messages ADD COLUMN folder TEXT NOT NULL DEFAULT 'inbox'")
  if (!msgColumns.includes('starred')) db.exec('ALTER TABLE messages ADD COLUMN starred INTEGER NOT NULL DEFAULT 0')
  if (!msgColumns.includes('from_email')) {
    db.exec('ALTER TABLE messages ADD COLUMN from_email TEXT')
    const rows = db.prepare('SELECT id, from_addr FROM messages').all() as { id: number; from_addr: string }[]
    const update = db.prepare('UPDATE messages SET from_email = ? WHERE id = ?')
    db.transaction(() => rows.forEach((r) => update.run(extractEmail(r.from_addr), r.id)))()
  }
  if (!msgColumns.includes('mailbox')) {
    // dotąd pobieraliśmy tylko INBOX, a gwiazdek z serwera nie czytaliśmy (NULL = scal przy pobraniu)
    db.exec(`
      ALTER TABLE messages ADD COLUMN mailbox TEXT;
      ALTER TABLE messages ADD COLUMN server_uid INTEGER;
      ALTER TABLE messages ADD COLUMN server_seen INTEGER;
      ALTER TABLE messages ADD COLUMN server_flagged INTEGER;
      UPDATE messages SET mailbox = 'INBOX', server_uid = uid, server_seen = read;
    `)
  }
  if (!msgColumns.includes('attachments_checked')) {
    db.exec('ALTER TABLE messages ADD COLUMN attachments_checked INTEGER NOT NULL DEFAULT 0')
  }
  // wiadomości sprzed indeksu pełnotekstowego nie mają wpisów w FTS: zbuduj go od nowa
  const indexed = (db.prepare('SELECT count(*) AS n FROM messages_fts_docsize').get() as { n: number }).n
  const total = (db.prepare('SELECT count(*) AS n FROM messages').get() as { n: number }).n
  if (indexed !== total) db.exec("INSERT INTO messages_fts(messages_fts) VALUES ('rebuild')")
  // indeksy na kolumnach z migracji, więc dopiero po ALTER TABLE
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_location ON messages(account_id, mailbox, server_uid);
    CREATE INDEX IF NOT EXISTS idx_messages_folder ON messages(folder, date DESC);
    CREATE INDEX IF NOT EXISTS idx_messages_from_email ON messages(from_email);
    CREATE INDEX IF NOT EXISTS idx_attachments_message ON attachments(message_id);
  `)
}
