import type { Priority, Rule, RuleCondition } from '@shared/types'

export interface MailFacts {
  from: string
  to: string
  subject: string
  body: string
  headers: Record<string, string>
}

export interface RuleResult {
  tags: string[]
  priority: Priority | null
}

function fieldValue(m: MailFacts, c: RuleCondition): string {
  switch (c.field) {
    case 'from':
      return m.from
    case 'to':
      return m.to
    case 'subject':
      return m.subject
    case 'body':
      return m.body
    case 'header':
      return m.headers[(c.header ?? '').toLowerCase()] ?? ''
  }
}

function matches(m: MailFacts, c: RuleCondition): boolean {
  const actual = fieldValue(m, c).toLowerCase()
  const expected = c.value.toLowerCase()
  switch (c.op) {
    case 'contains':
      return actual.includes(expected)
    case 'equals':
      return actual === expected
    case 'endsWith':
      return actual.endsWith(expected)
    case 'regex':
      try {
        return new RegExp(c.value, 'i').test(fieldValue(m, c))
      } catch {
        return false
      }
  }
}

/** Stosuje wszystkie włączone reguły; zbiera tagi, priorytet bierze z ostatniej pasującej reguły. */
export function applyRules(mail: MailFacts, rules: Rule[]): RuleResult {
  const tags = new Set<string>()
  let priority: Priority | null = null
  for (const rule of rules) {
    if (!rule.enabled || rule.conditions.length === 0) continue
    const hit =
      rule.match === 'all'
        ? rule.conditions.every((c) => matches(mail, c))
        : rule.conditions.some((c) => matches(mail, c))
    if (!hit) continue
    rule.addTags.forEach((t) => tags.add(t))
    if (rule.setPriority) priority = rule.setPriority
  }
  return { tags: [...tags], priority }
}
