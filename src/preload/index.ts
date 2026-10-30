import { contextBridge, ipcRenderer } from 'electron'
import type {
  Account,
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
  listTags: (): Promise<Tag[]> => ipcRenderer.invoke('tags:list'),
  createTag: (name: string, color: string | null): Promise<Tag> => ipcRenderer.invoke('tags:create', name, color),
  updateTag: (id: number, name: string, color: string | null): Promise<Tag> =>
    ipcRenderer.invoke('tags:update', id, name, color),
  deleteTag: (id: number): Promise<void> => ipcRenderer.invoke('tags:delete', id),
  /** Tylko istniejące tagi; nowe powstają wyłącznie w ustawieniach */
  tagMessages: (ids: number[], tagId: number, on: boolean): Promise<void> =>
    ipcRenderer.invoke('messages:tag', ids, tagId, on),
  openAttachment: (id: number): Promise<void> => ipcRenderer.invoke('attachments:open', id),
  /** false = użytkownik anulował wybór miejsca zapisu */
  saveAttachment: (id: number): Promise<boolean> => ipcRenderer.invoke('attachments:save', id),
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
