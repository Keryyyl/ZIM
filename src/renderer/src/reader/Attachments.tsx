import { useState } from 'react'
import type { Attachment } from '@shared/types'

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/** Komunikat z IPC ma przedrostek Electrona, który użytkownikowi nic nie mówi. */
function errorText(e: unknown): string {
  const text = e instanceof Error ? e.message : String(e)
  return text.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

export default function Attachments({ attachments }: { attachments: Attachment[] }): JSX.Element | null {
  // id załącznika, który się pobiera
  const [busy, setBusy] = useState<number | null>(null)
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null)

  if (attachments.length === 0) return null
  const files = attachments.filter((a) => !a.inline)
  const embedded = attachments.filter((a) => a.inline)

  const run = async (a: Attachment, action: 'open' | 'save'): Promise<void> => {
    setBusy(a.id)
    setMessage(null)
    try {
      if (action === 'open') await window.api.openAttachment(a.id)
      else if (await window.api.saveAttachment(a.id)) setMessage({ text: `Zapisano: ${a.filename}`, error: false })
    } catch (e) {
      setMessage({ text: errorText(e), error: true })
    } finally {
      setBusy(null)
    }
  }

  const item = (a: Attachment): JSX.Element => (
    <li key={a.id} className="attachment">
      <span className="attachment-name" title={a.filename}>
        {a.filename}
      </span>
      <span className="muted attachment-size">{formatSize(a.size)}</span>
      <button className="btn" disabled={busy !== null} onClick={() => void run(a, 'open')}>
        {busy === a.id ? 'Pobieranie…' : 'Otwórz'}
      </button>
      <button className="btn" disabled={busy !== null} onClick={() => void run(a, 'save')}>
        Zapisz jako…
      </button>
    </li>
  )

  return (
    <section className="attachments" aria-label="Załączniki">
      {files.length > 0 && <ul>{files.map(item)}</ul>}
      {embedded.length > 0 && (
        <details>
          <summary className="muted">Obrazki osadzone w treści ({embedded.length})</summary>
          <ul>{embedded.map(item)}</ul>
        </details>
      )}
      {message && (
        <p className={`attachments-message ${message.error ? 'error' : ''}`} role={message.error ? 'alert' : 'status'}>
          {message.text}
        </p>
      )}
    </section>
  )
}
