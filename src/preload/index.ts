import { contextBridge, ipcRenderer } from 'electron'
import type { CloudProvider } from '@shared/ai'
import type { ContactInit, ContactMail } from '@shared/contact'
import type {
  Account,
  AiConfig,
  AiStatus,
  Folder,
  MessageDetail,
  MessageQuery,
  MessageRow,
  OutgoingDraft,
  PickedFile,
  ScheduledMail,
  SyncStatus,
  Tag
} from '@shared/types'

const api = {
  listMessages: (query: MessageQuery): Promise<MessageRow[]> => ipcRenderer.invoke('messages:list', query),
  searchMessages: (query: { accountId: number | null; text: string }): Promise<MessageRow[]> =>
    ipcRenderer.invoke('messages:search', query),
  getMessage: (id: number): Promise<MessageDetail | null> => ipcRenderer.invoke('messages:get', id),
  markRead: (ids: number[], read: boolean): Promise<void> => ipcRenderer.invoke('messages:read', ids, read),
  starMessages: (ids: number[], starred: boolean): Promise<void> =>
    ipcRenderer.invoke('messages:star', ids, starred),
  moveMessages: (ids: number[], folder: Folder): Promise<void> =>
    ipcRenderer.invoke('messages:move', ids, folder),
  /** Zwraca liczbę zablokowanych nadawców */
  markSpam: (ids: number[]): Promise<number> => ipcRenderer.invoke('messages:spam', ids),
  markNotSpam: (ids: number[]): Promise<void> => ipcRenderer.invoke('messages:notSpam', ids),
  deleteForever: (ids: number[]): Promise<void> => ipcRenderer.invoke('messages:deleteForever', ids),
  listContacts: (): Promise<ContactInit[]> => ipcRenderer.invoke('contacts:list'),
  saveContact: (contact: ContactInit): Promise<ContactInit> => ipcRenderer.invoke('contacts:save', contact),
  contactMail: (id: number): Promise<ContactMail[]> => ipcRenderer.invoke('contacts:mail', id),
  deleteContact: (id: number): Promise<void> => ipcRenderer.invoke('contacts:delete', id),
  /** Okno wyboru zdjęcia; zwraca data URL albo null po anulowaniu */
  pickContactPhoto: (): Promise<string | null> => ipcRenderer.invoke('contacts:pickPhoto'),
  listTags: (): Promise<Tag[]> => ipcRenderer.invoke('tags:list'),
  createTag: (name: string, color: string | null, description: string): Promise<Tag> =>
    ipcRenderer.invoke('tags:create', name, color, description),
  updateTag: (id: number, name: string, color: string | null, description: string): Promise<Tag> =>
    ipcRenderer.invoke('tags:update', id, name, color, description),
  getAiStatus: (): Promise<AiStatus> => ipcRenderer.invoke('ai:status'),
  /** `consent` dołącza interfejs dopiero po zaznaczeniu zgody na wysyłanie treści maili do dostawcy w chmurze */
  setAiConfig: (config: AiConfig & { consent?: boolean }): Promise<void> => ipcRenderer.invoke('ai:setConfig', config),
  /** null usuwa klucz; klucza nie da się odczytać z powrotem */
  setAiKey: (provider: CloudProvider, key: string | null): Promise<void> => ipcRenderer.invoke('ai:setKey', provider, key),
  reprocessAi: (): Promise<void> => ipcRenderer.invoke('ai:reprocess'),
  /** Tagi od AI dla jednej wiadomości od razu; zwraca ją z nowymi tagami */
  summarizeMessage: (id: number, force = false): Promise<string | null> =>
    ipcRenderer.invoke('messages:summary', id, force),
  reclassifyMessage: (id: number): Promise<MessageDetail | null> => ipcRenderer.invoke('messages:reclassify', id),
  onAiTagged: (cb: () => void): (() => void) => {
    const listener = (): void => cb()
    ipcRenderer.on('ai:tagged', listener)
    return () => ipcRenderer.removeListener('ai:tagged', listener)
  },
  moveTag: (id: number, direction: 'up' | 'down'): Promise<void> => ipcRenderer.invoke('tags:move', id, direction),
  deleteTag: (id: number): Promise<void> => ipcRenderer.invoke('tags:delete', id),
  /** Tylko istniejące tagi; nowe powstają wyłącznie w ustawieniach */
  tagMessages: (ids: number[], tagId: number, on: boolean): Promise<void> =>
    ipcRenderer.invoke('messages:tag', ids, tagId, on),
  openAttachment: (id: number): Promise<void> => ipcRenderer.invoke('attachments:open', id),
  /** false = użytkownik anulował wybór miejsca zapisu */
  saveAttachment: (id: number): Promise<boolean> => ipcRenderer.invoke('attachments:save', id),
  /** Natywne okno „Zapisz jako”; false = użytkownik anulował */
  saveTextFile: (filename: string, content: string): Promise<boolean> =>
    ipcRenderer.invoke('files:saveText', filename, content),
  pickFiles: (): Promise<PickedFile[]> => ipcRenderer.invoke('compose:pickFiles'),
  sendMail: (draft: OutgoingDraft): Promise<void> => ipcRenderer.invoke('compose:send', draft),
  scheduleMail: (draft: OutgoingDraft, sendAt: number): Promise<number> =>
    ipcRenderer.invoke('compose:schedule', draft, sendAt),
  listScheduled: (accountId: number | null): Promise<ScheduledMail[]> => ipcRenderer.invoke('outbox:list', accountId),
  cancelScheduled: (id: number): Promise<void> => ipcRenderer.invoke('outbox:cancel', id),
  retryScheduled: (id: number): Promise<void> => ipcRenderer.invoke('outbox:retry', id),
  onOutboxChanged: (cb: () => void): (() => void) => {
    const listener = (): void => cb()
    ipcRenderer.on('outbox:changed', listener)
    return () => ipcRenderer.removeListener('outbox:changed', listener)
  },
  listAccounts: (): Promise<Account[]> => ipcRenderer.invoke('accounts:list'),
  addAccount: (
    input: Omit<Account, 'id' | 'smtpHost' | 'smtpPort'> &
      Partial<Pick<Account, 'smtpHost' | 'smtpPort'>> & { password: string }
  ): Promise<Account> =>
    ipcRenderer.invoke('accounts:add', input),
  setAccountAlias: (id: number, alias: string | null): Promise<string | null> =>
    ipcRenderer.invoke('accounts:setAlias', id, alias),
  removeAccount: (id: number): Promise<void> => ipcRenderer.invoke('accounts:remove', id),
  onSyncStatus: (cb: (s: SyncStatus) => void): (() => void) => {
    const listener = (_e: Electron.IpcRendererEvent, s: SyncStatus): void => cb(s)
    ipcRenderer.on('sync:status', listener)
    return () => ipcRenderer.removeListener('sync:status', listener)
  }
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api
