import { describe, expect, it } from 'vitest'
import { FAULT_DELAY_MAX_MS, FAULT_FOR_SECONDS_MAX, type ServerFaultRule } from '@shared'
import {
  describeFaultRule,
  draftFromRule,
  emptyDraft,
  moveRule,
  ruleFromDraft,
  secondsLeft,
  type FaultRuleDraft
} from '../faultRule'

const draft = (patch: Partial<FaultRuleDraft>): FaultRuleDraft => ({
  ...emptyDraft,
  code: '6',
  ...patch
})

describe('ruleFromDraft', () => {
  it('turns an empty form with an exception code into a rule with no condition', () => {
    expect(ruleFromDraft(draft({}))).toEqual({ rule: { action: { kind: 'exception', code: 6 } } })
  })

  it('carries every field of the schema', () => {
    const result = ruleFromDraft(
      draft({
        unitId: '4',
        registerType: 'holding_registers',
        addressStart: '100',
        addressEnd: '110',
        direction: 'write',
        everyNth: '3',
        forSeconds: '30'
      })
    )

    expect(result).toEqual({
      rule: {
        unitId: 4,
        registerType: 'holding_registers',
        addressRange: [100, 110],
        direction: 'write',
        action: { kind: 'exception', code: 6 },
        everyNth: 3,
        forSeconds: 30
      }
    })
  })

  it('takes a delay in milliseconds, and no response without a number', () => {
    expect(ruleFromDraft(draft({ actionKind: 'delay', ms: '500' })).rule?.action).toEqual({
      kind: 'delay',
      ms: 500
    })
    // The exception code left in the form does not leak into another action.
    expect(ruleFromDraft(draft({ actionKind: 'no_response' })).rule).toEqual({
      action: { kind: 'no_response' }
    })
  })

  it('keeps unit 0 and address 0, which are values and not empty', () => {
    expect(
      ruleFromDraft(draft({ unitId: '0', addressStart: '0', addressEnd: '0' })).rule
    ).toMatchObject({ unitId: 0, addressRange: [0, 0] })
  })

  it.each([
    ['an exception with no code', { code: '' }, 'code', 'Required'],
    ['an exception code of 0', { code: '0' }, 'code', undefined],
    ['an exception code of 256', { code: '256' }, 'code', undefined],
    ['a delay with no milliseconds', { actionKind: 'delay', ms: '' }, 'ms', 'Required'],
    ['a delay of 0 ms', { actionKind: 'delay', ms: '0' }, 'ms', undefined],
    [
      `a delay of ${FAULT_DELAY_MAX_MS + 1} ms`,
      { actionKind: 'delay', ms: String(FAULT_DELAY_MAX_MS + 1) },
      'ms',
      undefined
    ],
    ['a unit id of 256', { unitId: '256' }, 'unitId', undefined],
    ['a negative unit id', { unitId: '-1' }, 'unitId', undefined],
    ['a unit id with letters', { unitId: '4a' }, 'unitId', 'Not a number'],
    ['everyNth of 0', { everyNth: '0' }, 'everyNth', undefined],
    ['everyNth of 1.5', { everyNth: '1.5' }, 'everyNth', undefined],
    ['forSeconds of 0', { forSeconds: '0' }, 'forSeconds', undefined],
    [
      `forSeconds past ${FAULT_FOR_SECONDS_MAX}`,
      { forSeconds: String(FAULT_FOR_SECONDS_MAX + 1) },
      'forSeconds',
      undefined
    ],
    [
      'an address range with only a start',
      { addressStart: '5' },
      'addressRange',
      'Needs both ends'
    ],
    ['an address range with only an end', { addressEnd: '5' }, 'addressRange', 'Needs both ends'],
    [
      'an address range that ends before it starts',
      { addressStart: '10', addressEnd: '9' },
      'addressRange',
      'addressRange starts after it ends'
    ],
    ['an address past 65535', { addressStart: '0', addressEnd: '65536' }, 'addressRange', undefined]
  ] as [string, Partial<FaultRuleDraft>, string, string | undefined][])(
    'refuses %s, naming the field',
    (_name, patch, field, message) => {
      const result = ruleFromDraft(draft(patch))

      expect(result.rule).toBeUndefined()
      expect(Object.keys(result.errors ?? {})).toEqual([field])
      if (message !== undefined) expect(result.errors).toEqual({ [field]: message })
    }
  )

  it('takes the end of every range', () => {
    expect(
      ruleFromDraft(draft({ unitId: '255', addressStart: '0', addressEnd: '65535', everyNth: '1' }))
        .rule
    ).toMatchObject({ unitId: 255, addressRange: [0, 65535], everyNth: 1 })
    expect(
      ruleFromDraft(
        draft({ actionKind: 'delay', ms: String(FAULT_DELAY_MAX_MS), forSeconds: '0.5' })
      ).rule
    ).toMatchObject({ action: { ms: FAULT_DELAY_MAX_MS }, forSeconds: 0.5 })
  })
})

describe('draftFromRule', () => {
  const rules: ServerFaultRule[] = [
    { action: { kind: 'no_response' } },
    { unitId: 0, action: { kind: 'exception', code: 255 } },
    {
      unitId: 4,
      registerType: 'coils',
      addressRange: [0, 65535],
      direction: 'read',
      action: { kind: 'delay', ms: 30_000 },
      everyNth: 2,
      forSeconds: 1.5
    }
  ]

  it.each(rules.map((rule) => [describeFaultRule(rule), rule] as const))(
    'shows %s and gives the same rule back',
    (_name, rule) => {
      expect(ruleFromDraft(draftFromRule(rule))).toEqual({ rule })
    }
  )
})

describe('describeFaultRule', () => {
  it.each([
    [{ action: { kind: 'no_response' } }, 'every request: no response'],
    [{ unitId: 0, action: { kind: 'no_response' } }, 'unit 0: no response'],
    [{ action: { kind: 'exception', code: 6 } }, 'every request: exception 6'],
    [{ action: { kind: 'delay', ms: 250 } }, 'every request: delay 250 ms'],
    [
      {
        unitId: 4,
        registerType: 'holding_registers',
        addressRange: [100, 110],
        direction: 'write',
        action: { kind: 'exception', code: 2 },
        everyNth: 3,
        forSeconds: 30
      },
      'unit 4, holding_registers, addresses 100-110, writes: exception 2, every 3rd match, 30 s'
    ],
    [{ direction: 'read', action: { kind: 'no_response' } }, 'reads: no response'],
    [{ everyNth: 1, action: { kind: 'no_response' } }, 'every request: no response'],
    [
      { everyNth: 2, action: { kind: 'no_response' } },
      'every request: no response, every 2nd match'
    ],
    [
      { everyNth: 11, action: { kind: 'no_response' } },
      'every request: no response, every 11th match'
    ],
    [
      { everyNth: 22, action: { kind: 'no_response' } },
      'every request: no response, every 22nd match'
    ]
  ] as [ServerFaultRule, string][])('writes %j as "%s"', (rule, line) => {
    expect(describeFaultRule(rule)).toBe(line)
  })
})

describe('secondsLeft', () => {
  it('counts the seconds to expiry, rounded up', () => {
    expect(secondsLeft(10_000, 0)).toBe(10)
    expect(secondsLeft(10_001, 0)).toBe(11)
  })

  it('is 0 once the rule is past its time', () => {
    expect(secondsLeft(5_000, 9_000)).toBe(0)
  })
})

describe('moveRule', () => {
  const list = ['a', 'b', 'c']

  it('swaps a rule with its neighbour', () => {
    expect(moveRule(list, 1, -1)).toEqual(['b', 'a', 'c'])
    expect(moveRule(list, 1, 1)).toEqual(['a', 'c', 'b'])
  })

  it('leaves the list as it is at either end', () => {
    expect(moveRule(list, 0, -1)).toEqual(list)
    expect(moveRule(list, 2, 1)).toEqual(list)
  })
})
