export interface Account {
  id: number
  email: string
  /** Nazwa skrzynki widoczna w UI zamiast adresu, np. "Praca" */
  alias: string | null
  imapHost: string
  imapPort: number
  /** Wysyłka; to samo hasło co IMAP */
  smtpHost: string
  smtpPort: number
  username: string
  // hasło/token NIE trafia do bazy; jest w Keychain (safeStorage)
}

export interface Message {
  id: number
  accountId: number
  uid: number
  messageId: string | null
  threadId: string | null
  from: string
  to: string
  subject: string
  date: number // unix ms
  snippet: string
  bodyText: string
  bodyHtml: string | null
  read: boolean
}

/** Lokalny folder wiadomości; na serwerze mail zostaje tam, gdzie był */
export type Folder = 'inbox' | 'archive' | 'spam' | 'trash'

/** Folder albo widok "Oznaczone gwiazdką" (gwiazdka w każdym folderze poza spamem i koszem) */
export type MailboxView = Folder | 'starred' | 'all'

export interface MessageQuery {
  accountId: number | null // null = wszystkie konta
  view: MailboxView
  /** Tylko wiadomości z tym tagiem (z odebranych i archiwum), niezależnie od `view` */
  tagId?: number | null
  /** Cała korespondencja z tym adresem (od niego i do niego, wszystkie foldery poza usuniętymi) */
  correspondent?: string | null
}

/** Wiersz listy wiadomości (bez treści) */
export interface MessageRow {
  id: number
  accountId: number
  from: string
  subject: string
  date: number
  snippet: string
  read: boolean
  starred: boolean
  folder: Folder
  priority: Priority
  /** Ma załączniki inne niż obrazki osadzone w treści (ikona spinacza) */
  hasAttachments: boolean
  /** Tagi nadane wiadomości (lokalne, nie trafiają na serwer) */
  tags: Tag[]
}

/** Załącznik odebranej wiadomości; sama treść jest na serwerze, dopóki jej nie pobierzemy */
export interface Attachment {
  id: number
  filename: string
  mime: string
  size: number
  /** Obrazek osadzony w treści maila (np. logo w stopce) */
  inline: boolean
}

/** Nowa wiadomość z okna "Nowa wiadomość" */
export interface OutgoingDraft {
  accountId: number
  to: string[]
  subject: string
  text: string
  /** Tokeny plików wybranych w oknie systemowym (ścieżek renderer nie widzi) */
  attachments: string[]
}

export interface PickedFile {
  token: string
  name: string
  size: number
}

/** Wiadomość zaplanowana przez "Wyślij o" */
export interface ScheduledMail {
  id: number
  accountId: number
  to: string[]
  subject: string
  snippet: string
  sendAt: number
  status: 'scheduled' | 'sending' | 'error'
  error: string | null
  attachments: number
}

/** Pełna wiadomość do czytnika */
export interface MessageDetail extends MessageRow {
  to: string
  bodyText: string
  bodyHtml: string | null
  attachments: Attachment[]
  /** Skrót od asystenta AI (punkty rozdzielone \n); null = jeszcze nie powstał */
  summary: string | null
}

export type Priority = 'important' | 'normal' | 'noise'

export interface Tag {
  id: number
  name: string // np. "rekrutacja/potwierdzenie"
  color: string | null
  /** Opis dla asystenta AI, np. "automatyczne potwierdzenia aplikacji"; pusty = model zna tylko nazwę */
  description: string
}

export interface AiConfig {
  /** Automatyczne tagowanie nowych wiadomości lokalnym modelem */
  enabled: boolean
  /** Nazwa modelu w Ollamie, np. "gemma3:4b" */
  model: string
}

export type AiState = 'disabled' | 'idle' | 'working' | 'unavailable' | 'no-model' | 'no-tags'

export interface AiStatus extends AiConfig {
  state: AiState
  /** Wiadomości z ostatnich 30 dni czekające na tagi */
  pending: number
  error?: string
  /** Modele zainstalowane w Ollamie; null = Ollama nie odpowiada */
  models: string[] | null
}

/** Widok = zapytanie po tagach/priorytecie, np. "Główna" = priority important */
export interface View {
  id: number
  name: string
  includeTags: string[]
  excludeTags: string[]
  priority: Priority | null
  position: number
}

export type RuleField = 'from' | 'to' | 'subject' | 'body' | 'header'
export type RuleOp = 'contains' | 'equals' | 'endsWith' | 'regex'

export interface RuleCondition {
  field: RuleField
  op: RuleOp
  value: string
  header?: string // gdy field === 'header', np. "List-Unsubscribe"
}

export interface Rule {
  id: number
  name: string
  match: 'all' | 'any'
  conditions: RuleCondition[]
  addTags: string[]
  setPriority: Priority | null
  enabled: boolean
}

export interface SyncStatus {
  accountId: number
  state: 'syncing' | 'idle' | 'error'
  done: number
  total: number
  error?: string
}
