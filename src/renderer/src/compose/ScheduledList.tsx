import { useEffect, useState } from 'react'
import type { Account, ScheduledMail } from '@shared/types'

const whenFmt = new Intl.DateTimeFormat('pl-PL', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

interface Props {
  title: string
  accountId: number | null
  accountsById: Map<number, Account>
  showAccount: boolean
}

/** Wiadomości z "Wyślij o", które jeszcze nie wyszły (albo nie udało się ich wysłać). */
export default function ScheduledList({ title, accountId, accountsById, showAccount }: Props): JSX.Element {
  const [items, setItems] = useState<ScheduledMail[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let current = true
    const refresh = (): void => void window.api.listScheduled(accountId).then((list) => current && setItems(list))
    refresh()
    const unsubscribe = window.api.onOutboxChanged(refresh)
    return () => {
      current = false
      unsubscribe()
    }
  }, [accountId])

  const act = async (fn: () => Promise<void>): Promise<void> => {
    setError(null)
    try {
      await fn()
    } catch (err) {
      setError(String(err).replace(/^.*Error: /, ''))
    }
  }

  return (
    <main className="list">
      <header className="list-header">
        <div className="list-title">
          <h2>{title}</h2>
        </div>
        <div className="toolbar">
          {error ? (
            <span className="error">{error}</span>
          ) : (
            <span className="notice">Wiadomości wysyła ZIM o wybranej godzinie, gdy aplikacja jest włączona.</span>
          )}
        </div>
      </header>
      {items.length === 0 ? (
        <p className="empty">Brak zaplanowanych wiadomości.</p>
      ) : (
        items.map((m) => {
          const account = accountsById.get(m.accountId)
          return (
            <div key={m.id} className="row scheduled-row">
              <time className={`send-at ${m.status === 'error' ? 'error' : ''}`}>
                {m.status === 'sending' ? 'Wysyłanie…' : m.status === 'error' ? 'Błąd' : whenFmt.format(new Date(m.sendAt))}
              </time>
              <span className="from" title={m.to.join(', ')}>
                Do: {m.to.join(', ')}
              </span>
              {showAccount && account && (
                <span className="account-badge" title={account.email}>
                  {account.alias || account.email}
                </span>
              )}
              <span className="preview">
                <span className="subject">{m.subject || '(bez tematu)'}</span>
                {m.attachments > 0 && <span className="snippet"> 📎 {m.attachments}</span>}
                {m.status === 'error' ? (
                  <span className="error"> – {m.error}</span>
                ) : (
                  m.snippet && <span className="snippet"> – {m.snippet}</span>
                )}
              </span>
              <span className="row-actions">
                {m.status === 'error' && (
                  <button className="btn" onClick={() => act(() => window.api.retryScheduled(m.id))}>
                    Wyślij teraz
                  </button>
                )}
                {m.status !== 'sending' && (
                  <button
                    className="btn danger"
                    onClick={() =>
                      window.confirm('Anulować wysyłkę i usunąć tę wiadomość?') &&
                      act(() => window.api.cancelScheduled(m.id))
                    }
                  >
                    Anuluj
                  </button>
                )}
              </span>
            </div>
          )
        })
      )}
    </main>
  )
}
