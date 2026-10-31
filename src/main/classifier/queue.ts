import type Database from 'better-sqlite3'
import type { AiConfig, AiState, AiStatus, Tag } from '@shared/types'
import {
  countPending,
  loadForClassification,
  nextToClassify,
  recentSince,
  recordFailure,
  resetRecent,
  saveClassification,
  senderTags
} from '../db/classification'
import { listTags } from '../db/tags'
import type { Classify } from './llm'
import { AiUnavailable } from './errors'

export interface ClassifierDeps {
  db: Database.Database
  config: () => AiConfig
  classify: Classify
  /** Po każdej otagowanej wiadomości; wołający sam decyduje, jak często odświeżać UI */
  onTagged?: () => void
  /** Po przeniesieniu wiadomości do Archiwum (tag „Zachować”): trzeba wypchnąć zmianę na serwer */
  onArchived?: () => void
  now?: () => number
}

/** Reszta stanu (modele, klucze, zgody) jest składana w `index.ts`, bo zależy od Keychain i Ollamy */
export type QueueStatus = Omit<AiStatus, 'models' | 'keys' | 'consent' | 'modelsByProvider'>

/**
 * Tło tagowania: bierze po jednej niesklasyfikowanej wiadomości (od najnowszej) i pyta model.
 * Uruchamiana po synchronizacji; gdy Ollama nie działa, kończy po cichu i próbuje przy następnej.
 */
export function createClassifier({ db, config, classify, onTagged, onArchived, now = Date.now }: ClassifierDeps) {
  let running = false
  let again = false
  let state: AiState = 'idle'
  let error: string | undefined

  const set = (next: AiState, message?: string): void => {
    state = next
    error = message
  }

  async function pass(): Promise<void> {
    for (;;) {
      const cfg = config()
      if (!cfg.enabled) return set('disabled')
      const tags = listTags(db)
      if (tags.length === 0) return set('no-tags')
      const mail = nextToClassify(db, recentSince(now()))
      if (!mail) return set('idle')

      set('working')
      try {
        // nadawca noreply sprawdzony wcześniej: te same tagi bez pytania modelu
        const ids = senderTags(db, mail.id, recentSince(now())) ?? (await classify(tags, mail, cfg))
        if (saveClassification(db, mail.id, ids, now())) onArchived?.()
        onTagged?.()
      } catch (e) {
        if (e instanceof AiUnavailable) return set(e.reason === 'down' ? 'unavailable' : e.reason, e.message)
        console.error('klasyfikacja wiadomości:', (e as Error).message)
        recordFailure(db, mail.id)
      }
    }
  }

  async function run(): Promise<void> {
    if (running) {
      again = true // nowe dane przyszły w trakcie przebiegu
      return
    }
    running = true
    try {
      do {
        again = false
        await pass()
      } while (again)
    } finally {
      running = false
    }
  }

  return {
    kick(): void {
      void run()
    },

    status(): QueueStatus {
      const cfg = config()
      return {
        ...cfg,
        state: cfg.enabled ? state : 'disabled',
        pending: countPending(db, recentSince(now())),
        error
      }
    },

    /** Tagi ostatnich wiadomości liczone od nowa (np. po dodaniu tagów albo zmianie modelu). */
    reprocess(): void {
      resetRecent(db, recentSince(now()))
      void run()
    },

    /** Jedna wiadomość od razu; błędy trafiają do wołającego, bo użytkownik czeka na wynik. */
    async classifyNow(messageId: number): Promise<void> {
      const cfg = config()
      if (!cfg.enabled) throw new Error('Asystent AI jest wyłączony w ustawieniach')
      const tags: Tag[] = listTags(db)
      if (tags.length === 0) throw new Error('Najpierw utwórz tagi w Ustawieniach → Tagi')
      const mail = loadForClassification(db, messageId)
      if (!mail) throw new Error('Tej wiadomości już nie ma')
      if (saveClassification(db, messageId, await classify(tags, mail, cfg), now())) onArchived?.()
      onTagged?.()
    }
  }
}

export type Classifier = ReturnType<typeof createClassifier>
