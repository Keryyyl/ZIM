const UNSUPPORTED = new Set(['maxItems', 'minItems', 'maxLength', 'minLength'])

/**
 * Schemat odpowiedzi w wersji akceptowanej przez tryby „structured output” dostawców chmurowych:
 * obiekty zamknięte (additionalProperties: false), bez limitów długości. Limity i tak egzekwują
 * parsery odpowiedzi (`parseTagIds`, `parseSummary`), więc nic nie tracimy.
 */
export function strictSchema(schema: object): object {
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk)
    if (node === null || typeof node !== 'object') return node
    const out: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(node)) if (!UNSUPPORTED.has(key)) out[key] = walk(value)
    if (out.type === 'object') out.additionalProperties = false
    return out
  }
  return walk(schema) as object
}
