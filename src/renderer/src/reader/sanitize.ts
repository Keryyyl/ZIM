import DOMPurify from 'dompurify'

/**
 * HTML maila do wyświetlenia w iframe z sandboxem. Zdalne obrazki (i inne zasoby z sieci)
 * są blokowane, bo zdradzają nadawcy, że i kiedy mail został otwarty (piksele śledzące).
 * Blokujemy je dwa razy: tu (usuwamy adresy) i przez CSP w samym dokumencie iframe.
 */

const IFRAME_CSP = [
  "default-src 'none'",
  'img-src data:',
  "style-src 'unsafe-inline'",
  'font-src data:'
].join('; ')

// tylko wbudowane obrazki; cid: (załączniki) jeszcze nie obsługujemy
const isLocal = (url: string): boolean => /^data:/i.test(url.trim())
const REMOTE_URL_IN_CSS = /url\(\s*(['"]?)(?!data:)[^)]*\1\s*\)/gi

/** Kolory czytnika: maile HTML zakładają zwykle jasne tło, więc dajemy im białą kartkę. */
const BASE_STYLE = `
  html { background: #fff; color: #1a1a1a; }
  body { margin: 0; padding: 20px 24px; font: 14px/1.5 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
         overflow-wrap: anywhere; }
  img { max-width: 100%; height: auto; }
  table { max-width: 100%; }
  blockquote { margin: 0 0 0 8px; padding-left: 12px; border-left: 3px solid #ddd; color: #555; }
`

/**
 * Ciemny motyw: maile mają własne kolory (często jawnie białe tła), więc zamiast je podmieniać
 * odwracamy całą stronę, a obrazki odwracamy z powrotem. Tło #f4f3f1 po odwróceniu daje kolor
 * tła aplikacji (#0b0c0e), a tekst #1a1a1a biały.
 */
const DARK_STYLE = `
  html { background: #f4f3f1; filter: invert(1) hue-rotate(180deg); }
  img, video, svg image { filter: invert(1) hue-rotate(180deg); }
  blockquote { border-left-color: #bbb; color: #666; }
`

export interface SanitizedEmail {
  /** Pełny dokument do srcdoc */
  document: string
  blockedImages: number
}

export function sanitizeEmailHtml(html: string, dark = false): SanitizedEmail {
  let blockedImages = 0

  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    const el = node as Element
    if (!el.getAttribute) return
    let blocked = false
    // href poza <a> to zasób do pobrania (np. SVG <image href>), nie link
    const resourceAttrs = ['src', 'poster', 'background', ...(el.tagName === 'A' ? [] : ['href', 'xlink:href'])]
    for (const attr of resourceAttrs) {
      const value = el.getAttribute(attr)
      if (value && !isLocal(value)) {
        el.removeAttribute(attr)
        blocked = true
      }
    }
    if (el.hasAttribute('srcset')) {
      el.removeAttribute('srcset')
      blocked = true
    }
    if (blocked && el.tagName === 'IMG') blockedImages++
    const style = el.getAttribute('style')
    const cleaned = style?.replace(REMOTE_URL_IN_CSS, 'none')
    if (style && cleaned !== style) el.setAttribute('style', cleaned!)
    if (el.tagName === 'A') {
      // linki otwieramy w przeglądarce (setWindowOpenHandler w procesie głównym)
      el.setAttribute('target', '_blank')
      el.setAttribute('rel', 'noopener noreferrer')
    }
  })

  let root: HTMLElement
  try {
    // WHOLE_DOCUMENT + RETURN_DOM zwraca <html>, razem z <head> i stylami maila
    root = DOMPurify.sanitize(html, {
      WHOLE_DOCUMENT: true,
      RETURN_DOM: true,
      FORBID_TAGS: ['form', 'input', 'button', 'textarea', 'select', 'link', 'meta', 'base'],
      FORBID_ATTR: ['action', 'formaction']
    }) as unknown as HTMLElement
  } finally {
    DOMPurify.removeHook('afterSanitizeAttributes')
  }

  const doc = root.ownerDocument
  let head = root.querySelector('head')
  if (!head) {
    head = doc.createElement('head')
    root.prepend(head)
  }
  // <style> z maila też może ładować zasoby z sieci
  head.querySelectorAll('style').forEach((s) => (s.textContent = (s.textContent ?? '').replace(REMOTE_URL_IN_CSS, 'none')))
  root.querySelectorAll('body style').forEach((s) => (s.textContent = (s.textContent ?? '').replace(REMOTE_URL_IN_CSS, 'none')))

  const csp = doc.createElement('meta')
  csp.setAttribute('http-equiv', 'Content-Security-Policy')
  csp.setAttribute('content', IFRAME_CSP)
  const charset = doc.createElement('meta')
  charset.setAttribute('charset', 'utf-8')
  const base = doc.createElement('base')
  base.setAttribute('target', '_blank')
  const style = doc.createElement('style')
  style.textContent = dark ? BASE_STYLE + DARK_STYLE : BASE_STYLE
  // CSP pierwsze, żeby obowiązywało zanim przeglądarka zobaczy cokolwiek z maila
  head.prepend(csp, charset, base, style)

  return { document: `<!doctype html>${root.outerHTML}`, blockedImages }
}
