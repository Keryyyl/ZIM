import { useRef, type ClipboardEvent, type KeyboardEvent } from 'react'

const EMAIL = /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/

export function isEmail(value: string): boolean {
  return EMAIL.test(value)
}

/** "Jan <jan@x.pl>, ola@y.pl; ewa@z.pl" -> ["jan@x.pl", "ola@y.pl", "ewa@z.pl"] */
export function parseAddresses(text: string): string[] {
  return text
    .replace(/[^,;<>]*<([^>]+)>/g, ' $1 ')
    .split(/[,;\s]+/)
    .map((a) => a.trim())
    .filter(Boolean)
}

interface Props {
  id: string
  value: string[]
  onChange: (value: string[]) => void
  /** Wpisany, jeszcze niezatwierdzony tekst (doliczany przy wysyłce) */
  text: string
  onTextChange: (text: string) => void
}

export default function RecipientInput({ id, value, onChange, text, onTextChange }: Props): JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null)

  const commit = (raw: string): void => {
    const added = parseAddresses(raw).filter((a) => !value.some((v) => v.toLowerCase() === a.toLowerCase()))
    if (added.length > 0) onChange([...value, ...added])
    onTextChange('')
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (['Enter', ',', ';', ' '].includes(e.key) || (e.key === 'Tab' && text.trim())) {
      if (!text.trim()) return
      e.preventDefault()
      commit(text)
    } else if (e.key === 'Backspace' && !text && value.length > 0) {
      onChange(value.slice(0, -1))
    }
  }

  const onPaste = (e: ClipboardEvent<HTMLInputElement>): void => {
    const pasted = e.clipboardData.getData('text')
    if (parseAddresses(pasted).length > 1 || /[,;\n]/.test(pasted)) {
      e.preventDefault()
      commit(text + ' ' + pasted)
    }
  }

  return (
    <div className="recipients" onMouseDown={(e) => e.target === e.currentTarget && inputRef.current?.focus()}>
      {value.map((address) => {
        const valid = isEmail(address)
        return (
          <span key={address} className={`chip ${valid ? '' : 'invalid'}`} title={valid ? address : 'Nieprawidłowy adres'}>
            {address}
            <button
              type="button"
              className="chip-remove"
              onClick={() => onChange(value.filter((v) => v !== address))}
              aria-label={`Usuń ${address}`}
            >
              ×
            </button>
          </span>
        )
      })}
      <input
        ref={inputRef}
        id={id}
        value={text}
        onChange={(e) => onTextChange(e.target.value)}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        onBlur={() => text.trim() && commit(text)}
        placeholder={value.length === 0 ? 'adres@example.com, kolejny@example.com' : ''}
        autoComplete="off"
        spellCheck={false}
      />
    </div>
  )
}
