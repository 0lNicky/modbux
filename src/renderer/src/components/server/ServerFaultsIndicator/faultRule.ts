import {
  ServerFaultRuleSchema,
  type RegisterType,
  type ServerFaultRule,
  type ServerFaultRuleStatus
} from '@shared'

/**
 * The form as text: every field a user can type into or leave empty.
 *
 * An empty condition means "any", so the draft keeps `''` and `ruleFromDraft`
 * turns it into an absent key, which is how `ServerFaultRuleSchema` spells it.
 */
export interface FaultRuleDraft {
  unitId: string
  registerType: RegisterType | ''
  addressStart: string
  addressEnd: string
  direction: 'read' | 'write' | ''
  actionKind: ServerFaultRule['action']['kind']
  code: string
  ms: string
  everyNth: string
  forSeconds: string
}

export type FaultRuleField =
  | 'unitId'
  | 'registerType'
  | 'addressRange'
  | 'direction'
  | 'code'
  | 'ms'
  | 'everyNth'
  | 'forSeconds'

export type FaultRuleErrors = Partial<Record<FaultRuleField, string>>

export const emptyDraft: FaultRuleDraft = {
  unitId: '',
  registerType: '',
  addressStart: '',
  addressEnd: '',
  direction: '',
  actionKind: 'exception',
  code: '',
  ms: '',
  everyNth: '',
  forSeconds: ''
}

/** A rule as the form shows it. */
export const draftFromRule = (rule: ServerFaultRule): FaultRuleDraft => ({
  unitId: rule.unitId === undefined ? '' : String(rule.unitId),
  registerType: rule.registerType ?? '',
  addressStart: rule.addressRange === undefined ? '' : String(rule.addressRange[0]),
  addressEnd: rule.addressRange === undefined ? '' : String(rule.addressRange[1]),
  direction: rule.direction ?? '',
  actionKind: rule.action.kind,
  code: rule.action.kind === 'exception' ? String(rule.action.code) : '',
  ms: rule.action.kind === 'delay' ? String(rule.action.ms) : '',
  everyNth: rule.everyNth === undefined ? '' : String(rule.everyNth),
  forSeconds: rule.forSeconds === undefined ? '' : String(rule.forSeconds)
})

/** `undefined` for an empty field, a number for a number, `NaN` for anything else. */
const numberOf = (text: string): number | undefined =>
  text.trim() === '' ? undefined : Number(text)

const isFilled = (text: string): boolean => text.trim() !== ''

/**
 * The rule a draft says, or what is wrong with it, by field.
 *
 * `ServerFaultRuleSchema` decides. A field that is not a number, or is missing
 * where the action needs it, is refused here first, because the schema would
 * answer `NaN` or `undefined` with a type error nobody can act on.
 */
export const ruleFromDraft = (
  draft: FaultRuleDraft
):
  | { rule: ServerFaultRule; errors?: undefined }
  | { rule?: undefined; errors: FaultRuleErrors } => {
  const errors: FaultRuleErrors = {}

  const numbers: [FaultRuleField, string][] = [
    ['unitId', draft.unitId],
    ['everyNth', draft.everyNth],
    ['forSeconds', draft.forSeconds]
  ]
  if (draft.actionKind === 'exception') numbers.push(['code', draft.code])
  if (draft.actionKind === 'delay') numbers.push(['ms', draft.ms])
  for (const [field, text] of numbers) {
    const needed = field === 'code' || field === 'ms'
    if (needed && !isFilled(text)) errors[field] = 'Required'
    else if (!Number.isFinite(numberOf(text) ?? 0)) errors[field] = 'Not a number'
  }

  const start = numberOf(draft.addressStart)
  const end = numberOf(draft.addressEnd)
  if (start === undefined && end === undefined) {
    // No range: any address.
  } else if (start === undefined || end === undefined) {
    errors.addressRange = 'Needs both ends'
  } else if (!Number.isFinite(start) || !Number.isFinite(end)) {
    errors.addressRange = 'Not a number'
  }

  if (Object.keys(errors).length > 0) return { errors }

  const action =
    draft.actionKind === 'exception'
      ? { kind: 'exception', code: numberOf(draft.code) }
      : draft.actionKind === 'delay'
        ? { kind: 'delay', ms: numberOf(draft.ms) }
        : { kind: 'no_response' }

  const parsed = ServerFaultRuleSchema.safeParse({
    ...(isFilled(draft.unitId) && { unitId: numberOf(draft.unitId) }),
    ...(draft.registerType !== '' && { registerType: draft.registerType }),
    ...(isFilled(draft.addressStart) && { addressRange: [start, end] }),
    ...(draft.direction !== '' && { direction: draft.direction }),
    action,
    ...(isFilled(draft.everyNth) && { everyNth: numberOf(draft.everyNth) }),
    ...(isFilled(draft.forSeconds) && { forSeconds: numberOf(draft.forSeconds) })
  })
  if (parsed.success) return { rule: parsed.data }

  // A schema issue is named by its first path key, or by the second under `action`.
  for (const issue of parsed.error.issues) {
    const [first, second] = issue.path
    const field = (first === 'action' ? second : first) as FaultRuleField
    errors[field] ??= issue.message
  }
  return { errors }
}

const ordinal = (n: number): string => {
  const lastTwo = n % 100
  if (lastTwo >= 11 && lastTwo <= 13) return `${n}th`
  const suffixes: Record<number, string> = { 1: 'st', 2: 'nd', 3: 'rd' }
  const suffix = suffixes[n % 10] ?? 'th'
  return `${n}${suffix}`
}

/**
 * One line for a rule: what it matches, then what it does, then when.
 *
 * `unit 4, holding_registers, addresses 100-110, writes: exception 6, every 3rd match, 30 s`
 * A rule with no condition says `every request`.
 */
export const describeFaultRule = (rule: ServerFaultRule): string => {
  const conditions = [
    rule.unitId === undefined ? undefined : `unit ${rule.unitId}`,
    rule.registerType,
    rule.addressRange === undefined
      ? undefined
      : `addresses ${rule.addressRange[0]}-${rule.addressRange[1]}`,
    rule.direction === undefined ? undefined : rule.direction === 'read' ? 'reads' : 'writes'
  ].filter((part) => part !== undefined)

  const action =
    rule.action.kind === 'exception'
      ? `exception ${rule.action.code}`
      : rule.action.kind === 'delay'
        ? `delay ${rule.action.ms} ms`
        : 'no response'

  const when = [
    rule.everyNth === undefined || rule.everyNth === 1
      ? undefined
      : `every ${ordinal(rule.everyNth)} match`,
    rule.forSeconds === undefined ? undefined : `${rule.forSeconds} s`
  ].filter((part) => part !== undefined)

  return `${conditions.length === 0 ? 'every request' : conditions.join(', ')}: ${[action, ...when].join(', ')}`
}

/** What `forSeconds` leaves of a rule at `now`, rounded up so a live rule never reads 0. */
export const secondsLeft = (expiresAt: number, now: number): number =>
  Math.max(0, Math.ceil((expiresAt - now) / 1000))

/** The rule a status row stands for, without the counts. */
export const ruleOfStatus = (status: ServerFaultRuleStatus): ServerFaultRule =>
  ServerFaultRuleSchema.parse(status)

/** `list` with the rule at `index` moved by `step` places, or as it was where there is no such place. */
export const moveRule = <T>(list: T[], index: number, step: -1 | 1): T[] => {
  const target = index + step
  const moving = list[index]
  const swapped = list[target]
  if (moving === undefined || swapped === undefined) return list
  return list.map((item, i) => (i === index ? swapped : i === target ? moving : item))
}
