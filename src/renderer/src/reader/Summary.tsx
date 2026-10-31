import { useEffect, useState } from 'react'
import type { MessageDetail } from '@shared/types'
import { isSummarizable } from '@shared/summary'

const OPEN_KEY = 'zim.summary.open'

function loadOpen(): boolean {
  try {
    return localStorage.getItem(OPEN_KEY) !== '0'
  } catch {
    return true
  }
}

type State = 'loading' | 'ready' | 'none' | 'error'

/** Skrót wiadomości od asystenta AI nad treścią; powstaje dopiero po otwarciu i jest zapamiętany. */
export default function Summary({ message }: { message: MessageDetail }): JSX.Element | null {
  const [text, setText] = useState<string | null>(message.summary)
  const [state, setState] = useState<State>(message.summary ? 'ready' : 'loading')
  const [error, setError] = useState('')
  const [open, setOpen] = useState(loadOpen)
  const eligible = isSummarizable(message.bodyText)

  const generate = (force: boolean): void => {
    setState('loading')
    window.api
      .summarizeMessage(message.id, force)
      .then((summary) => {
        setText(summary)
        setState(summary ? 'ready' : 'none')
      })
      .catch((err) => {
        setError(String(err).replace(/^.*Error: /, ''))
        setState('error')
      })
  }

  // komponent jest tworzony od nowa dla każdej wiadomości (key), więc wystarczy jednorazowe uruchomienie
  useEffect(() => {
    if (eligible && !message.summary) generate(false)
  }, [])

  if (!eligible || state === 'none') return null

  const points = (text ?? '').split('\n').filter(Boolean)
  return (
    <details
      className="summary"
      open={open}
      onToggle={(e) => {
        const next = e.currentTarget.open
        setOpen(next)
        try {
          localStorage.setItem(OPEN_KEY, next ? '1' : '0')
        } catch {
          /* bez zapamiętania: nic się nie dzieje */
        }
      }}
    >
      <summary>
        Skrót AI {state === 'loading' && <span className="muted">· czytam wiadomość…</span>}
      </summary>
      {state === 'error' && (
        <p className="error" role="alert">
          {error} <button className="btn" onClick={() => generate(false)}>Spróbuj ponownie</button>
        </p>
      )}
      {state === 'ready' &&
        (points.length === 1 ? (
          <p className="summary-text">{points[0]}</p>
        ) : (
          <ul className="summary-text">
            {points.map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
        ))}
      {state === 'ready' && (
        <button className="btn summary-refresh" onClick={() => generate(true)} title="Napisz skrót od nowa">
          Odśwież
        </button>
      )}
    </details>
  )
}
