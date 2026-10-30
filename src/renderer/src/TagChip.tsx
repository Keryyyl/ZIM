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
    </span>
  )
}
