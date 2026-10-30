import { SIDEBAR_SHORTCUT } from './settings/sidebar'

/** Ten sam przycisk chowa i przywraca pasek boczny. */
export default function SidebarToggle({ onToggle }: { onToggle: () => void }): JSX.Element {
  return (
    <button
      className="icon-btn sidebar-toggle"
      onClick={onToggle}
      aria-label="Pokaż lub ukryj pasek boczny"
      title={`Pokaż / ukryj pasek boczny (${SIDEBAR_SHORTCUT})`}
    >
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
        <path d="M4 6h16M4 12h16M4 18h16" />
      </svg>
    </button>
  )
}
