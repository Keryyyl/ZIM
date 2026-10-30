import { useEffect, useRef, useState } from 'react'
import type { Tag } from '@shared/types'

export const TAG_COLORS = ['#3b82f6', '#8b5cf6', '#ec4899', '#ef4444', '#f59e0b', '#10b981', '#06b6d4', '#71717a']

interface Props {
  tag: Tag
  /** Pokazuje przycisk × zdejmujący tag */
  onRemove?: () => void
}

export default function TagChip({ tag, onRemove }: Props): JSX.Element {
  return (
    <span className="tag-chip" style={tag.color ? ({ '--tag': tag.color } as React.CSSProperties) : undefined}>
      <span className="tag-dot" />
      <span className="tag-name">{tag.name}</span>
      {onRemove && (
        <button className="tag-remove" onClick={onRemove} aria-label={`Zdejmij tag ${tag.name}`} title="Zdejmij tag">
          ✕
        </button>
      )}
    </span>
  )
}

const HEX = /^#[0-9a-f]{6}$/i

function toRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function toHex([r, g, b]: [number, number, number]): string {
  return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')
}

const CHANNELS = [
  { label: 'R', index: 0 },
  { label: 'G', index: 1 },
  { label: 'B', index: 2 }
] as const

/** Ostatnia pastylka palety: własny kolor wybierany suwakami RGB albo wpisany jako #rrggbb. */
function CustomColor({ value, onChange }: { value: string | null; onChange: (c: string) => void }): JSX.Element {
  const [open, setOpen] = useState(false)
  const [hexText, setHexText] = useState('')
  const ref = useRef<HTMLSpanElement>(null)
  const isCustom = value !== null && !TAG_COLORS.includes(value.toLowerCase())
  const rgb = toRgb(value && HEX.test(value) ? value : '#3b82f6')

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      e.stopPropagation() // Esc zamyka tylko picker, nie całe ustawienia
      setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [open])

  const setChannel = (index: number, v: number): void => {
    const next: [number, number, number] = [...rgb]
    next[index] = Math.max(0, Math.min(255, Math.round(v) || 0))
    const hex = toHex(next)
    setHexText(hex)
    onChange(hex)
  }

  return (
    <span className="custom-color" ref={ref}>
      <button
        type="button"
        className={`swatch swatch-custom ${isCustom ? 'on' : ''}`}
        style={isCustom ? { background: value! } : undefined}
        aria-label="Własny kolor"
        title="Własny kolor"
        aria-expanded={open}
        onClick={() => {
          setHexText(toHex(rgb))
          setOpen((o) => !o)
        }}
      />
      {open && (
        <div className="rgb-popover" role="dialog" aria-label="Własny kolor">
          <div className="rgb-preview" style={{ background: toHex(rgb) }} />
          {CHANNELS.map(({ label, index }) => {
            const from = toHex(rgb.map((v, i) => (i === index ? 0 : v)) as [number, number, number])
            const end = toHex(rgb.map((v, i) => (i === index ? 255 : v)) as [number, number, number])
            return (
              <label key={label} className="rgb-row">
                <span>{label}</span>
                <input
                  type="range"
                  min={0}
                  max={255}
                  value={rgb[index]}
                  style={{ background: `linear-gradient(to right, ${from}, ${end})` }}
                  onChange={(e) => setChannel(index, Number(e.target.value))}
                />
                <input
                  type="number"
                  min={0}
                  max={255}
                  value={rgb[index]}
                  onChange={(e) => setChannel(index, Number(e.target.value))}
                />
              </label>
            )
          })}
          <label className="rgb-row">
            <span>#</span>
            <input
              className="rgb-hex"
              value={hexText.replace('#', '')}
              maxLength={6}
              spellCheck={false}
              aria-label="Kolor jako #rrggbb"
              onChange={(e) => {
                const text = '#' + e.target.value.replace(/[^0-9a-f]/gi, '').slice(0, 6)
                setHexText(text)
                if (HEX.test(text)) onChange(text.toLowerCase())
              }}
            />
          </label>
        </div>
      )}
    </span>
  )
}

export function ColorPicker({ value, onChange }: { value: string | null; onChange: (c: string) => void }): JSX.Element {
  return (
    <span className="color-picker" role="radiogroup" aria-label="Kolor tagu">
      {TAG_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={value === c}
          className={`swatch ${value === c ? 'on' : ''}`}
          style={{ background: c }}
          onClick={() => onChange(c)}
          aria-label={c}
        />
      ))}
      <CustomColor value={value} onChange={onChange} />
    </span>
  )
}
