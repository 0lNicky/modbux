/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ServerFaultRule } from '@shared'
import { FaultRequest, ServerFaults } from '../faults'

const uuid = 'server-under-test'

const read = (overrides: Partial<FaultRequest> = {}): FaultRequest => ({
  unitId: 1,
  registerType: 'holding_registers',
  address: 10,
  count: 2,
  direction: 'read',
  ...overrides
})

const NO_RESPONSE = { kind: 'no_response' } as const
const exception = (code: number) => ({ kind: 'exception' as const, code })

let changes: [string, ServerFaultRule[]][]
/** The version each change carried, in the order `changes` holds them. */
let changedVersions: number[]
let faults: ServerFaults

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  changes = []
  changedVersions = []
  faults = new ServerFaults({
    onChange: (changed, rules, version) => {
      changes.push([changed, rules])
      changedVersions.push(version)
    }
  })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('the rule list', () => {
  it('answers the list it was given, and says so', () => {
    const rules: ServerFaultRule[] = [{ unitId: 1, action: NO_RESPONSE }]

    expect(faults.set(uuid, rules)).toEqual(rules)
    expect(faults.list(uuid)).toEqual(rules)
    expect(changes).toEqual([[uuid, rules]])
  })

  it('replaces the list rather than adding to it', () => {
    faults.set(uuid, [{ unitId: 1, action: NO_RESPONSE }])
    faults.set(uuid, [{ unitId: 2, action: exception(6) }])

    expect(faults.list(uuid)).toEqual([{ unitId: 2, action: exception(6) }])
  })

  it('keeps each server its own list', () => {
    faults.set(uuid, [{ action: NO_RESPONSE }])

    expect(faults.list('another-server')).toEqual([])
    expect(faults.decide('another-server', read())).toBeUndefined()
  })

  it('empties on clear, and says so', () => {
    faults.set(uuid, [{ action: NO_RESPONSE }])
    faults.clear(uuid)

    expect(faults.list(uuid)).toEqual([])
    expect(faults.decide(uuid, read())).toBeUndefined()
    expect(changes.at(-1)).toEqual([uuid, []])
  })

  it('says nothing for a clear of a server that holds no rules', () => {
    faults.clear(uuid)

    expect(changes).toEqual([])
  })

  it('answers every server that holds rules, and no other', () => {
    faults.set(uuid, [{ action: NO_RESPONSE }])
    faults.set('emptied', [{ action: NO_RESPONSE }])
    faults.clear('emptied')

    expect(faults.all()).toEqual({ [uuid]: [{ action: NO_RESPONSE }] })
  })
})

describe('which rule decides a request', () => {
  it('lets the first rule that matches decide, so the order is the priority', () => {
    faults.set(uuid, [
      { unitId: 2, action: exception(6) },
      { unitId: 1, action: exception(4) },
      { action: NO_RESPONSE }
    ])

    expect(faults.decide(uuid, read({ unitId: 1 }))).toEqual({ rule: 1, action: exception(4) })
    expect(faults.decide(uuid, read({ unitId: 2 }))).toEqual({ rule: 0, action: exception(6) })
    expect(faults.decide(uuid, read({ unitId: 3 }))).toEqual({ rule: 2, action: NO_RESPONSE })
  })

  it('matches on the register type', () => {
    faults.set(uuid, [{ registerType: 'coils', action: NO_RESPONSE }])

    expect(faults.decide(uuid, read({ registerType: 'coils' }))).toBeDefined()
    expect(faults.decide(uuid, read({ registerType: 'holding_registers' }))).toBeUndefined()
  })

  it('matches on the direction', () => {
    faults.set(uuid, [{ direction: 'write', action: exception(1) }])

    expect(faults.decide(uuid, read({ direction: 'write' }))).toBeDefined()
    expect(faults.decide(uuid, read({ direction: 'read' }))).toBeUndefined()
  })

  it('matches a request touching any address of the range, both ends included', () => {
    faults.set(uuid, [{ addressRange: [100, 109], action: NO_RESPONSE }])

    // 98 and 99, the address below the range: not inside.
    expect(faults.decide(uuid, read({ address: 98, count: 2 }))).toBeUndefined()
    // 99 and 100: its last address is the range's first.
    expect(faults.decide(uuid, read({ address: 99, count: 2 }))).toBeDefined()
    // 109 alone: the range's last address.
    expect(faults.decide(uuid, read({ address: 109, count: 1 }))).toBeDefined()
    // 110 on: past it.
    expect(faults.decide(uuid, read({ address: 110, count: 5 }))).toBeUndefined()
    // 90 to 119: covers the whole range from outside both ends.
    expect(faults.decide(uuid, read({ address: 90, count: 30 }))).toBeDefined()
  })

  it('takes every condition a rule has, not any one of them', () => {
    faults.set(uuid, [{ unitId: 1, direction: 'write', action: NO_RESPONSE }])

    expect(faults.decide(uuid, read({ unitId: 1, direction: 'read' }))).toBeUndefined()
    expect(faults.decide(uuid, read({ unitId: 2, direction: 'write' }))).toBeUndefined()
    expect(faults.decide(uuid, read({ unitId: 1, direction: 'write' }))).toBeDefined()
  })
})

describe('everyNth', () => {
  it('decides the Nth matching request and every Nth after it', () => {
    faults.set(uuid, [{ everyNth: 3, action: NO_RESPONSE }])

    const decided = Array.from({ length: 7 }, () => faults.decide(uuid, read()) !== undefined)

    expect(decided).toEqual([false, false, true, false, false, true, false])
  })

  it('counts the requests that match the rule, not every request', () => {
    faults.set(uuid, [{ unitId: 1, everyNth: 2, action: NO_RESPONSE }])

    faults.decide(uuid, read({ unitId: 1 }))
    faults.decide(uuid, read({ unitId: 9 }))
    faults.decide(uuid, read({ unitId: 9 }))

    expect(faults.decide(uuid, read({ unitId: 1 }))).toEqual({ rule: 0, action: NO_RESPONSE })
  })

  it('serves a request its rule matched and did not decide, rather than asking the next rule', () => {
    faults.set(uuid, [{ everyNth: 2, action: exception(6) }, { action: NO_RESPONSE }])

    expect(faults.decide(uuid, read())).toBeUndefined()
    expect(faults.decide(uuid, read())).toEqual({ rule: 0, action: exception(6) })
  })

  it('counts from the start again when the list is replaced', () => {
    faults.set(uuid, [{ everyNth: 2, action: NO_RESPONSE }])
    faults.decide(uuid, read())
    faults.set(uuid, [{ everyNth: 2, action: NO_RESPONSE }])

    expect(faults.decide(uuid, read())).toBeUndefined()
  })
})

describe('forSeconds', () => {
  it('removes the rule once its time is up, and says so', () => {
    faults.set(uuid, [
      { unitId: 1, forSeconds: 2, action: NO_RESPONSE },
      { unitId: 2, action: exception(6) }
    ])

    vi.advanceTimersByTime(1999)
    expect(faults.decide(uuid, read({ unitId: 1 }))).toBeDefined()

    vi.advanceTimersByTime(1)
    expect(faults.decide(uuid, read({ unitId: 1 }))).toBeUndefined()
    expect(faults.list(uuid)).toEqual([{ unitId: 2, action: exception(6) }])
    expect(changes.at(-1)).toEqual([uuid, [{ unitId: 2, action: exception(6) }]])
  })

  it('removes nothing from a list that replaced the one it timed', () => {
    faults.set(uuid, [{ forSeconds: 1, action: NO_RESPONSE }])
    faults.set(uuid, [{ action: exception(6) }])

    vi.advanceTimersByTime(5000)

    expect(faults.list(uuid)).toEqual([{ action: exception(6) }])
  })

  it('removes nothing after a clear', () => {
    faults.set(uuid, [{ forSeconds: 1, action: NO_RESPONSE }])
    faults.clear(uuid)
    const said = changes.length

    vi.advanceTimersByTime(5000)

    expect(changes).toHaveLength(said)
  })
})

describe('the status', () => {
  it('counts what each rule matched and decided, and when it expires', () => {
    const now = Date.now()
    faults.set(uuid, [
      { unitId: 1, everyNth: 2, action: NO_RESPONSE },
      { unitId: 2, forSeconds: 10, action: exception(6) }
    ])
    faults.decide(uuid, read({ unitId: 1 }))
    faults.decide(uuid, read({ unitId: 1 }))
    faults.decide(uuid, read({ unitId: 1 }))
    faults.decide(uuid, read({ unitId: 2 }))

    expect(faults.status(uuid)).toEqual([
      { unitId: 1, everyNth: 2, action: NO_RESPONSE, matched: 3, triggered: 1 },
      {
        unitId: 2,
        forSeconds: 10,
        action: exception(6),
        matched: 1,
        triggered: 1,
        expiresAt: now + 10_000
      }
    ])
  })
})

// A window writes back a list it read, and the version is how main tells
// whether that list is still the one it holds.
describe('the version of a list', () => {
  const ONE: ServerFaultRule[] = [{ unitId: 1, action: NO_RESPONSE }]
  const TWO: ServerFaultRule[] = [{ unitId: 2, action: exception(6) }]

  it('changes on every set, including an MCP set of the same list, and the change carries it', () => {
    const before = faults.version(uuid)
    faults.set(uuid, ONE)
    const afterFirst = faults.version(uuid)
    faults.set(uuid, ONE)

    expect(afterFirst).not.toBe(before)
    expect(faults.version(uuid)).not.toBe(afterFirst)
    expect(changedVersions).toEqual([afterFirst, faults.version(uuid)])
  })

  it('changes on a clear and on an expiry', () => {
    faults.set(uuid, [{ forSeconds: 1, action: NO_RESPONSE }, ...TWO])
    const set = faults.version(uuid)
    vi.advanceTimersByTime(1000)
    const expired = faults.version(uuid)
    faults.clear(uuid)

    expect(expired).not.toBe(set)
    expect(faults.version(uuid)).not.toBe(expired)
    expect(changedVersions).toEqual([set, expired, faults.version(uuid)])
  })

  it('changes when the server is forgotten, even with no rules, and says so only when it had some', () => {
    const empty = faults.version(uuid)
    faults.forget(uuid)
    const forgottenEmpty = faults.version(uuid)
    faults.set(uuid, ONE)
    const said = changes.length
    faults.forget(uuid)

    expect(forgottenEmpty).not.toBe(empty)
    expect(changes).toHaveLength(said + 1)
    expect(changes.at(-1)).toEqual([uuid, []])
    expect(changedVersions.at(-1)).toBe(faults.version(uuid))
  })

  it('does not change when a request is decided, or for another server', () => {
    faults.set(uuid, ONE)
    const version = faults.version(uuid)

    faults.decide(uuid, read({ unitId: 1 }))
    faults.set('another-server', TWO)
    faults.clear('a-server-with-no-rules')

    expect(faults.version(uuid)).toBe(version)
  })

  it('never answers a version a list already had, even after it emptied', () => {
    faults.set(uuid, ONE)
    const first = faults.version(uuid)
    faults.clear(uuid)
    faults.set(uuid, ONE)

    expect(faults.version(uuid)).not.toBe(first)
  })

  it('answers the status with the version it belongs to', () => {
    faults.set(uuid, ONE)

    expect(faults.snapshot(uuid)).toEqual({
      version: faults.version(uuid),
      rules: [{ ...ONE[0], matched: 0, triggered: 0 }]
    })
  })

  it('replaces the list for the version it holds, and says so with the new one', () => {
    faults.set(uuid, ONE)
    const read = faults.version(uuid)

    expect(faults.replace(uuid, read, TWO)).toBe(true)
    expect(faults.list(uuid)).toEqual(TWO)
    expect(faults.version(uuid)).not.toBe(read)
    expect(changes.at(-1)).toEqual([uuid, TWO])
  })

  it('refuses a version it no longer holds, and changes nothing', () => {
    faults.set(uuid, ONE)
    const read = faults.version(uuid)
    faults.set(uuid, TWO)
    const now = faults.version(uuid)
    const said = changes.length

    expect(faults.replace(uuid, read, ONE)).toBe(false)
    expect(faults.list(uuid)).toEqual(TWO)
    expect(faults.version(uuid)).toBe(now)
    expect(changes).toHaveLength(said)
  })

  it('refuses the version a list had before it expired', () => {
    faults.set(uuid, [{ forSeconds: 1, action: NO_RESPONSE }, ...TWO])
    const read = faults.version(uuid)
    vi.advanceTimersByTime(1000)

    expect(faults.replace(uuid, read, [])).toBe(false)
    expect(faults.list(uuid)).toEqual(TWO)
  })

  it('takes the first of two windows that read the same list, and refuses the second', () => {
    faults.set(uuid, ONE)
    const bothRead = faults.version(uuid)

    expect(faults.replace(uuid, bothRead, [...ONE, ...TWO])).toBe(true)
    expect(faults.replace(uuid, bothRead, [])).toBe(false)
    expect(faults.list(uuid)).toEqual([...ONE, ...TWO])
  })

  it('takes a write to a server that never held rules at the version it answered', () => {
    expect(faults.replace(uuid, faults.version(uuid), ONE)).toBe(true)
    expect(faults.list(uuid)).toEqual(ONE)
  })
})
