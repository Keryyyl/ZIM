import { RIGHT_SIDEBAR_SHORTCUT, SIDEBAR_SHORTCUT } from './settings/sidebar'

/** Ten sam przycisk chowa i przywraca lewy (domyślnie) albo prawy pasek boczny. */
export default function SidebarToggle({ onToggle, side = 'left' }: { onToggle: () => void; side?: 'left' | 'right' }): JSX.Element {
  const label = side === 'left' ? 'lewy pasek boczny' : 'prawy pasek boczny'
  const shortcut = side === 'left' ? SIDEBAR_SHORTCUT : RIGHT_SIDEBAR_SHORTCUT
  return (
    <button
      className="icon-btn sidebar-toggle"
      onClick={onToggle}
      aria-label={`Pokaż lub ukryj ${label}`}
      title={`Pokaż / ukryj ${label} (${shortcut})`}
    >
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
        <path d="M4 6h16M4 12h16M4 18h16" />
      </svg>
    </button>
  )
}
