import type { MessageStructureObject } from 'imapflow'

/** Załącznik opisany w BODYSTRUCTURE: treść pobieramy dopiero na żądanie. */
export interface AttachmentInfo {
  /** Numer części MIME na serwerze, np. "2" albo "1.2" */
  part: string
  filename: string
  mime: string
  /** Rozmiar po zdekodowaniu (przybliżony) */
  size: number
  contentId: string | null
  /** Obrazek osadzony w treści (cid:), np. logo w stopce */
  inline: boolean
}

const BODY_TYPES = new Set(['text/plain', 'text/html'])
const DEFAULT_NAMES: Record<string, string> = {
  'message/rfc822': 'wiadomość.eml',
  'text/calendar': 'zaproszenie.ics'
}

/** Pliki, które system może uruchomić zamiast otworzyć; przed otwarciem pytamy o zgodę. */
const RISKY_EXTENSIONS = new Set([
  'exe', 'bat', 'cmd', 'com', 'scr', 'msi', 'app', 'command', 'sh', 'scpt', 'jar', 'js', 'jse', 'vbs',
  'vbe', 'ps1', 'dmg', 'pkg', 'workflow', 'terminal', 'hta', 'lnk', 'pif', 'cpl', 'reg', 'wsf', 'action', 'apk'
])

/** Zbiera załączniki z drzewa BODYSTRUCTURE (części tekstowe z treścią maila pomijamy). */
export function collectAttachments(root: MessageStructureObject): AttachmentInfo[] {
  const found: AttachmentInfo[] = []
  const walk = (node: MessageStructureObject): void => {
    const mime = node.type.toLowerCase()
    // załączona wiadomość (.eml) to jedna całość: nie wchodzimy do jej części
    if (node.childNodes?.length && mime !== 'message/rfc822') {
      node.childNodes.forEach(walk)
      return
    }
    if (mime.startsWith('multipart/')) return
    const filename = node.dispositionParameters?.filename ?? node.parameters?.name ?? ''
    const disposition = node.disposition?.toLowerCase()
    if (BODY_TYPES.has(mime) && disposition !== 'attachment' && !filename) return
    const size = node.size ?? 0
    found.push({
      // wiadomość bez multipart ma jedną część, którą serwer nazywa "1"
      part: node.part ?? '1',
      filename: filename || DEFAULT_NAMES[mime] || 'załącznik',
      mime,
      size: node.encoding?.toLowerCase() === 'base64' ? Math.floor((size * 3) / 4) : size,
      contentId: node.id ? node.id.replace(/^<|>$/g, '') : null,
      inline: disposition === 'inline' && !!node.id
    })
  }
  walk(root)
  return found
}

/** Nazwa pliku z maila to dane od obcej osoby: bez ścieżek, znaków sterujących i ukrytych plików. */
export function safeFilename(name: string): string {
  const cleaned = name
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/^[.\s]+/, '')
    .trim()
  if (!cleaned) return 'załącznik'
  if (cleaned.length <= 150) return cleaned
  const dot = cleaned.lastIndexOf('.')
  const ext = dot > 0 && cleaned.length - dot <= 10 ? cleaned.slice(dot) : ''
  return cleaned.slice(0, 150 - ext.length) + ext
}

export function isRisky(filename: string): boolean {
  const match = /\.([^.\\/\s]+)[.\s]*$/.exec(filename.toLowerCase())
  return !!match && RISKY_EXTENSIONS.has(match[1])
}
