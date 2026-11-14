// @vitest-environment happy-dom
/// <reference types="@testing-library/jest-dom/vitest" />
import { cleanup, fireEvent as dom, render, screen, within } from '@testing-library/react'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ServerFaultRule, ServerFaultStatus, ServerFaultWrite } from '@shared'

vi.mock('notistack', () => ({
  useSnackbar: (): { enqueueSnackbar: () => void } => ({ enqueueSnackbar: vi.fn() }),
  enqueueSnackbar: vi.fn()
}))

import {
  fireEvent,
  recordApiCalls,
  stubRenderer,
  type ApiCall
} from '@renderer/context/__tests__/stubRenderer'

const UUID = 'the-server-on-503'
const BUSY = { unitId: 4, action: { kind: 'exception', code: 6 } } as const
const SILENT = { registerType: 'coils', action: { kind: 'no_response' } } as const
const SLOW = { direction: 'read', action: { kind: 'delay', ms: 250 }, forSeconds: 60 } as const

/** Every list main answers gets the next version, the way main's one counter only grows. */
let lastVersion = 0
const statusOf = (rules: ServerFaultRule[]): ServerFaultStatus => {
  lastVersion += 1
  return {
    version: lastVersion,
    exists: true,
    rules: rules.map((rule, i) => ({
      ...rule,
      matched: 10 + i,
      triggered: 5 + i,
      ...(rule.forSeconds !== undefined && { expiresAt: Date.now() + rule.forSeconds * 1000 })
    }))
  }
}

/** What main holds for `UUID`, which `set_server_faults` compares its version against. */
let main: ServerFaultStatus = statusOf([])
/** While set, `get_server_fault_status` waits for a test to answer it, one reply per call. */
let holdStatus = true
let pending: Array<(status: ServerFaultStatus) => void> = []
/** While set, `set_server_faults` waits for a test to answer it, one reply per call. */
let holdWrites = false
let heldWrites: Array<(answer: ServerFaultWrite | undefined) => void> = []

/** Main holds `rules` from now on, and answers every status request at once. */
const mainHolds = (rules: ServerFaultRule[]): void => {
  main = statusOf(rules)
  holdStatus = false
}

/**
 * Main's `replace`: a write at the version it holds is taken, `server_faults`
 * goes out before the reply as `ServerFaults` sends it, and a stale one changes
 * nothing.
 */
const mainWrites = ({
  version,
  rules
}: {
  version: number
  rules: ServerFaultRule[]
}): ServerFaultWrite => {
  if (!main.exists || version !== main.version) return { taken: false, status: main }
  main = statusOf(rules)
  fireEvent('server_faults', { uuid: UUID, version: main.version, rules })
  return { taken: true, status: main }
}

stubRenderer()
{
  const underneath = window.api as unknown as Record<string, unknown>
  window.api = new Proxy(
    {},
    {
      get: (_target, name: string): unknown =>
        name === 'getServerFaultStatus'
          ? (): Promise<ServerFaultStatus> =>
              holdStatus
                ? new Promise((resolve) => {
                    pending.push(resolve)
                  })
                : Promise.resolve(main)
          : name === 'setServerFaults'
            ? (payload: {
                version: number
                rules: ServerFaultRule[]
              }): Promise<ServerFaultWrite | undefined> =>
                holdWrites
                  ? new Promise((resolve) => {
                      heldWrites.push(resolve)
                    })
                  : Promise.resolve(mainWrites(payload))
            : underneath[name]
    }
  ) as never
}

/** Answers the status request `n` with `status`, and throws when request `n` was never made. */
const answerStatus = async (n: number, status: ServerFaultStatus): Promise<void> => {
  const release = pending[n]
  if (!release) throw new Error(`no status request ${n} is out`)
  await act(async () => {
    release(status)
  })
}
const calls: ApiCall[] = []
recordApiCalls(calls)

const { useServerFaultsDialogZustand } = await import('../serverFaultsDialog.zustand')
const { ruleOfStatus } = await import('../faultRule')
const ServerFaultsDialog = (await import('../ServerFaultsDialog')).default

/** Opens the dialog for `UUID` and lets the status request go out. */
const openDialog = async (): Promise<void> => {
  render(<ServerFaultsDialog />)
  await act(async () => {
    useServerFaultsDialogZustand.getState().show(UUID)
  })
}

type Sent = { uuid: string; version: number; rules: ServerFaultRule[] }
const sent = (): Sent[] =>
  calls.filter(({ method }) => method === 'setServerFaults').map(({ payload }) => payload as Sent)
/** The writes sent, each without the version it carried. */
const sets = (): unknown[] => sent().map(({ uuid, rules }) => ({ uuid, rules }))

/** The list main delivers in `server_faults` for `UUID`. */
const announce = (status: ServerFaultStatus): void => {
  fireEvent('server_faults', {
    uuid: UUID,
    version: status.version,
    rules: status.rules.map(ruleOfStatus)
  })
}

beforeEach(() => {
  calls.length = 0
  pending = []
  main = statusOf([])
  holdStatus = true
  holdWrites = false
  heldWrites = []
  useServerFaultsDialogZustand.getState().close()
})

afterEach(cleanup)

describe('what the dialog shows', () => {
  it('asks main for the status of the server it was opened for, and shows one row per rule', async () => {
    mainHolds([BUSY, SILENT, SLOW])

    await openDialog()

    expect(calls).toEqual([{ method: 'getServerFaultStatus', payload: UUID }])
    expect(screen.getByTestId('server-faults-rule-0-summary')).toHaveTextContent(
      'unit 4: exception 6'
    )
    expect(screen.getByTestId('server-faults-rule-1-summary')).toHaveTextContent(
      'coils: no response'
    )
    expect(screen.getByTestId('server-faults-rule-2-summary')).toHaveTextContent(
      'reads: delay 250 ms, 60 s'
    )
    expect(screen.queryByTestId('server-faults-rule-3')).not.toBeInTheDocument()
  })

  it('shows what each rule has done, and the seconds a forSeconds rule has left', async () => {
    mainHolds([BUSY, SILENT, SLOW])

    await openDialog()

    expect(screen.getByTestId('server-faults-rule-0-counts')).toHaveTextContent(
      'triggered 5 / matched 10'
    )
    expect(screen.getByTestId('server-faults-rule-1-counts')).toHaveTextContent(
      'triggered 6 / matched 11'
    )
    expect(screen.queryByTestId('server-faults-rule-0-left')).not.toBeInTheDocument()
    expect(screen.getByTestId('server-faults-rule-2-left')).toHaveTextContent('60 s left')
  })

  it('says so when the server has no rules, and offers no clear all', async () => {
    mainHolds([])

    await openDialog()

    expect(screen.getByTestId('server-faults-empty')).toBeInTheDocument()
    expect(screen.getByTestId('server-faults-clear-all-btn')).toBeDisabled()
  })

  it('says in one line that a change starts every count and clock over', async () => {
    mainHolds([])

    await openDialog()

    expect(screen.getByTestId('server-faults-dialog')).toHaveTextContent(
      'Every change replaces the whole list: all counts and “for seconds” clocks start over.'
    )
  })

  it('reads again when refresh is pressed, and shows the new counts', async () => {
    mainHolds([BUSY])
    await openDialog()
    main = { ...main, rules: [{ ...BUSY, matched: 99, triggered: 98 }] }

    await act(async () => {
      dom.click(screen.getByTestId('server-faults-refresh-btn'))
    })

    expect(screen.getByTestId('server-faults-rule-0-counts')).toHaveTextContent(
      'triggered 98 / matched 99'
    )
  })

  it('reads again when server_faults names its server, and not when it names another', async () => {
    mainHolds([BUSY])
    await openDialog()
    calls.length = 0

    await act(async () => {
      fireEvent('server_faults', { uuid: 'another-server', version: lastVersion + 1, rules: [] })
    })
    expect(calls).toEqual([])

    await act(async () => {
      fireEvent('server_faults', { uuid: UUID, version: lastVersion + 1, rules: [BUSY] })
    })
    expect(calls).toEqual([{ method: 'getServerFaultStatus', payload: UUID }])
  })

  it('does not ask while the dialog is closed', () => {
    fireEvent('server_faults', { uuid: UUID, version: lastVersion + 1, rules: [BUSY] })

    expect(calls).toEqual([])
  })
})

describe('a status reply that is older than the last server_faults', () => {
  const OLD = statusOf([BUSY])
  const NEW = statusOf([SILENT, SLOW])

  it('does not put its rules on screen when it arrives after the newer reply', async () => {
    await openDialog()
    // The first request is the one the open sent, and it is still out.
    expect(pending).toHaveLength(1)

    await act(async () => {
      announce(NEW)
    })
    expect(pending).toHaveLength(2)
    await answerStatus(1, NEW)
    await answerStatus(0, OLD)

    expect(screen.getByTestId('server-faults-rule-0-summary')).toHaveTextContent('coils')
    expect(screen.queryByTestId('server-faults-rule-2')).not.toBeInTheDocument()
    expect(screen.getAllByTestId(/^server-faults-rule-\d$/)).toHaveLength(2)
  })

  it('does not put its rules on screen while the newer request is still out', async () => {
    await openDialog()
    await act(async () => {
      announce(statusOf([]))
    })
    expect(calls).toEqual([
      { method: 'getServerFaultStatus', payload: UUID },
      { method: 'getServerFaultStatus', payload: UUID }
    ])

    await answerStatus(0, OLD)

    expect(screen.queryByTestId('server-faults-rule-0')).not.toBeInTheDocument()
  })

  it('keeps the newest reply when two refresh presses answer out of order', async () => {
    await openDialog()
    await act(async () => {
      dom.click(screen.getByTestId('server-faults-refresh-btn'))
    })

    await answerStatus(1, NEW)
    await answerStatus(0, OLD)

    expect(screen.getAllByTestId(/^server-faults-rule-\d$/)).toHaveLength(2)
  })

  it('still shows an answer that nothing overtook', async () => {
    await openDialog()

    await answerStatus(0, OLD)

    expect(screen.getByTestId('server-faults-rule-0-summary')).toHaveTextContent('unit 4')
  })

  it('does not write into a dialog that closed and opened on another server', async () => {
    await openDialog()
    await act(async () => {
      useServerFaultsDialogZustand.getState().close()
      useServerFaultsDialogZustand.getState().show('the-other-server')
    })

    await answerStatus(0, OLD)
    expect(screen.queryByTestId('server-faults-rule-0')).not.toBeInTheDocument()

    await answerStatus(1, NEW)
    expect(screen.getAllByTestId(/^server-faults-rule-\d$/)).toHaveLength(2)
  })
})

describe('the buttons that change the list', () => {
  const THREE = [BUSY, SILENT, SLOW]

  beforeEach(() => {
    mainHolds(THREE)
  })

  it('moves a rule up by sending the list with it one place earlier', async () => {
    await openDialog()

    await act(async () => {
      dom.click(screen.getByTestId('server-faults-rule-1-up'))
    })

    expect(sets()).toEqual([{ uuid: UUID, rules: [SILENT, BUSY, SLOW] }])
  })

  it('moves a rule down', async () => {
    await openDialog()

    await act(async () => {
      dom.click(screen.getByTestId('server-faults-rule-1-down'))
    })

    expect(sets()).toEqual([{ uuid: UUID, rules: [BUSY, SLOW, SILENT] }])
  })

  it('cannot move the first rule up or the last one down', async () => {
    await openDialog()

    expect(screen.getByTestId('server-faults-rule-0-up')).toBeDisabled()
    expect(screen.getByTestId('server-faults-rule-2-down')).toBeDisabled()
    expect(screen.getByTestId('server-faults-rule-0-down')).toBeEnabled()
    expect(screen.getByTestId('server-faults-rule-2-up')).toBeEnabled()
  })

  it('sends the rules without their counts or expiry', async () => {
    await openDialog()

    await act(async () => {
      dom.click(screen.getByTestId('server-faults-rule-0-delete'))
    })

    const sent = sets()[0] as { rules: Record<string, unknown>[] }
    for (const rule of sent.rules) {
      expect(rule).not.toHaveProperty('matched')
      expect(rule).not.toHaveProperty('triggered')
      expect(rule).not.toHaveProperty('expiresAt')
    }
  })

  it('deletes the rule it names and keeps the others in order', async () => {
    await openDialog()

    await act(async () => {
      dom.click(screen.getByTestId('server-faults-rule-1-delete'))
    })

    expect(sets()).toEqual([{ uuid: UUID, rules: [BUSY, SLOW] }])
  })

  it('clears all through clear_server_faults', async () => {
    await openDialog()
    calls.length = 0

    await act(async () => {
      dom.click(screen.getByTestId('server-faults-clear-all-btn'))
    })

    expect(calls).toEqual([{ method: 'clearServerFaults', payload: UUID }])
  })

  it('refuses a 33rd rule', async () => {
    mainHolds(Array.from({ length: 32 }, () => BUSY))

    await openDialog()

    expect(screen.getByTestId('server-faults-add-btn')).toBeDisabled()
  })

  it('closes with the close button', async () => {
    await openDialog()

    await act(async () => {
      dom.click(screen.getByTestId('server-faults-close-btn'))
    })

    expect(useServerFaultsDialogZustand.getState().open).toBe(false)
  })
})

const type = (testId: string, value: string): void => {
  dom.change(screen.getByTestId(testId), { target: { value } })
}

/** Picks `option` in the select a test id names. */
const choose = async (testId: string, option: string): Promise<void> => {
  await act(async () => {
    dom.mouseDown(within(screen.getByTestId(testId)).getByRole('combobox'))
  })
  await act(async () => {
    dom.click(screen.getByRole('option', { name: option }))
  })
}

describe('the form', () => {
  beforeEach(() => {
    mainHolds([BUSY, SILENT])
  })

  it('opens empty for a new rule, and cannot save until the action is whole', async () => {
    await openDialog()

    await act(async () => {
      dom.click(screen.getByTestId('server-faults-add-btn'))
    })

    expect(screen.getByTestId('fault-form-save-btn')).toBeDisabled()
    type('fault-form-code', '6')
    expect(screen.getByTestId('fault-form-save-btn')).toBeEnabled()
  })

  it('adds the rule at the end of the whole list, with every field it was given', async () => {
    await openDialog()
    await act(async () => {
      dom.click(screen.getByTestId('server-faults-add-btn'))
    })

    type('fault-form-unit-id', '7')
    await choose('fault-form-register-type', 'holding_registers')
    await choose('fault-form-direction', 'Write')
    type('fault-form-address-start', '100')
    type('fault-form-address-end', '110')
    await act(async () => {
      dom.click(screen.getByTestId('fault-form-action-delay'))
    })
    type('fault-form-ms', '500')
    type('fault-form-every-nth', '3')
    type('fault-form-for-seconds', '30')
    await act(async () => {
      dom.click(screen.getByTestId('fault-form-save-btn'))
    })

    expect(sets()).toEqual([
      {
        uuid: UUID,
        rules: [
          BUSY,
          SILENT,
          {
            unitId: 7,
            registerType: 'holding_registers',
            direction: 'write',
            addressRange: [100, 110],
            action: { kind: 'delay', ms: 500 },
            everyNth: 3,
            forSeconds: 30
          }
        ]
      }
    ])
  })

  it('offers no_response without asking for a number', async () => {
    await openDialog()
    await act(async () => {
      dom.click(screen.getByTestId('server-faults-add-btn'))
    })

    await act(async () => {
      dom.click(screen.getByTestId('fault-form-action-no-response'))
    })

    expect(screen.queryByTestId('fault-form-code')).not.toBeInTheDocument()
    expect(screen.queryByTestId('fault-form-ms')).not.toBeInTheDocument()
    expect(screen.getByTestId('fault-form-save-btn')).toBeEnabled()
  })

  it('shows what is wrong beside the field and sends nothing', async () => {
    await openDialog()
    await act(async () => {
      dom.click(screen.getByTestId('server-faults-add-btn'))
    })

    type('fault-form-code', '300')
    type('fault-form-address-start', '5')

    expect(screen.getByText('Needs both ends')).toBeInTheDocument()
    expect(screen.getByTestId('fault-form-save-btn')).toBeDisabled()
    expect(sets()).toEqual([])
  })

  it('opens an edit with the rule’s fields, and replaces only that rule', async () => {
    await openDialog()

    await act(async () => {
      dom.click(screen.getByTestId('server-faults-rule-0-edit'))
    })
    expect(screen.getByTestId('fault-form-unit-id')).toHaveValue('4')
    expect(screen.getByTestId('fault-form-code')).toHaveValue('6')

    type('fault-form-code', '2')
    await act(async () => {
      dom.click(screen.getByTestId('fault-form-save-btn'))
    })

    expect(sets()).toEqual([
      { uuid: UUID, rules: [{ unitId: 4, action: { kind: 'exception', code: 2 } }, SILENT] }
    ])
  })

  it('goes back to the list on cancel and sends nothing', async () => {
    await openDialog()
    await act(async () => {
      dom.click(screen.getByTestId('server-faults-rule-0-edit'))
    })

    await act(async () => {
      dom.click(screen.getByTestId('fault-form-cancel-btn'))
    })

    expect(screen.getByTestId('server-faults-rule-0')).toBeInTheDocument()
    expect(sets()).toEqual([])
  })
})

/** A taken write's reply, carrying a list no dialog under test holds. */
const TAKEN: ServerFaultWrite = { taken: true, status: statusOf([SILENT, SILENT, SILENT]) }

/** What `set_server_faults` answers next: a refusal is `undefined`. */
const refuseNextWrite = (): void => {
  const underneath = window.api as unknown as Record<string, unknown>
  window.api = new Proxy(
    {},
    {
      get: (_target, name: string): unknown =>
        name === 'setServerFaults'
          ? (payload: unknown): Promise<undefined> => {
              calls.push({ method: 'setServerFaults', payload })
              window.api = underneath as never
              return Promise.resolve(undefined)
            }
          : underneath[name]
    }
  ) as never
}

/** Delivers a changed list the way main does: the event, then the status it asks for. */
const mainChangesTheList = async (rules: ServerFaultRule[]): Promise<void> => {
  mainHolds(rules)
  await act(async () => {
    announce(main)
  })
}

const FOUR = [1, 2, 3, 4].map(
  (unitId): ServerFaultRule => ({ unitId, action: { kind: 'exception', code: 6 } })
)
/** The nth of `FOUR`, which a missing one would make the test throw by name. */
const four = (n: number): ServerFaultRule => {
  const rule = FOUR[n]
  if (!rule) throw new Error(`FOUR has no rule ${n}`)
  return rule
}
const code = (unitId: number, value: number): ServerFaultRule => ({
  unitId,
  action: { kind: 'exception', code: value }
})

describe('an edit while main changes the list', () => {
  beforeEach(() => {
    mainHolds(FOUR)
  })

  const editThird = async (): Promise<void> => {
    await openDialog()
    await act(async () => {
      dom.click(screen.getByTestId('server-faults-rule-2-edit'))
    })
    type('fault-form-code', '2')
  }

  const save = async (): Promise<void> => {
    await act(async () => {
      dom.click(screen.getByTestId('fault-form-save-btn'))
    })
  }

  it('replaces the rule picked where it now sits after an earlier rule expired', async () => {
    await editThird()

    await mainChangesTheList(FOUR.slice(1))
    await save()

    expect(sets()).toEqual([{ uuid: UUID, rules: [four(1), code(3, 2), four(3)] }])
  })

  it('replaces the rule picked after an MCP reorder', async () => {
    await editThird()

    await mainChangesTheList([four(3), four(2), four(1), four(0)])
    await save()

    expect(sets()).toEqual([{ uuid: UUID, rules: [four(3), code(3, 2), four(1), FOUR[0]] }])
  })

  it('keeps the form and the draft when the rule is gone, and says so', async () => {
    await editThird()

    await mainChangesTheList([four(0), four(1), four(3)])

    expect(screen.getByTestId('fault-form-gone')).toHaveTextContent(
      'This rule no longer exists. Saving adds it as a new rule.'
    )
    expect(screen.getByTestId('fault-form-code')).toHaveValue('2')
    expect(sets()).toEqual([])
  })

  it('adds the draft as a new rule, and touches no other, once the rule is gone', async () => {
    await editThird()
    await mainChangesTheList([four(0), four(1), four(3)])

    await save()

    expect(sets()).toEqual([{ uuid: UUID, rules: [four(0), four(1), FOUR[3], code(3, 2)] }])
  })

  it('shows no notice while the rule is still there, wherever it moved', async () => {
    await editThird()

    await mainChangesTheList(FOUR.slice(1))

    expect(screen.queryByTestId('fault-form-gone')).not.toBeInTheDocument()
  })

  // Position is priority: the first rule that matches decides, so two equal
  // rules at two places are two different rules.
  const A = { action: { kind: 'exception', code: 6 } } as const
  const B = { unitId: 1, action: { kind: 'no_response' } } as const
  const C = { unitId: 2, action: { kind: 'exception', code: 2 } } as const

  it('replaces the rule at the place picked when an equal rule sits before it', async () => {
    mainHolds([A, B, A])
    await openDialog()
    await act(async () => {
      dom.click(screen.getByTestId('server-faults-rule-2-edit'))
    })
    type('fault-form-unit-id', '2')
    type('fault-form-code', '2')

    await save()

    expect(sets()).toEqual([{ uuid: UUID, rules: [A, B, C] }])
  })

  it('replaces the rule at the place picked after main changed the list around it', async () => {
    mainHolds([A, B, A])
    await openDialog()
    await act(async () => {
      dom.click(screen.getByTestId('server-faults-rule-2-edit'))
    })
    type('fault-form-unit-id', '2')
    type('fault-form-code', '2')
    await mainChangesTheList([A, B, A, four(0)])

    await save()

    expect(sets()).toEqual([{ uuid: UUID, rules: [A, B, C, four(0)] }])
  })

  it('treats the rule as gone when the list changed and two rules are equal to it', async () => {
    mainHolds([four(0), A, B, A])
    await openDialog()
    await act(async () => {
      dom.click(screen.getByTestId('server-faults-rule-1-edit'))
    })
    type('fault-form-unit-id', '2')
    type('fault-form-code', '2')

    await mainChangesTheList([A, B, A])

    expect(screen.getByTestId('fault-form-gone')).toBeInTheDocument()
    await save()
    expect(sets()).toEqual([{ uuid: UUID, rules: [A, B, A, C] }])
  })

  it('follows the one equal rule to its new place when the list changed', async () => {
    mainHolds([A, B])
    await openDialog()
    await act(async () => {
      dom.click(screen.getByTestId('server-faults-rule-0-edit'))
    })
    type('fault-form-unit-id', '2')
    type('fault-form-code', '2')
    await mainChangesTheList([B, A])

    expect(screen.queryByTestId('fault-form-gone')).not.toBeInTheDocument()
    await save()
    expect(sets()).toEqual([{ uuid: UUID, rules: [B, C] }])
  })
})

describe('a write that cannot succeed', () => {
  const full = (): ServerFaultRule[] => Array.from({ length: 32 }, (_, i) => code(i, 6))

  it('keeps the form and the draft when the list filled up under it, and says why', async () => {
    mainHolds(full().slice(0, 31))
    await openDialog()
    await act(async () => {
      dom.click(screen.getByTestId('server-faults-add-btn'))
    })
    type('fault-form-code', '6')

    await mainChangesTheList(full())
    await act(async () => {
      dom.click(screen.getByTestId('fault-form-save-btn'))
    })

    expect(sets()).toEqual([])
    expect(screen.getByTestId('fault-form-code')).toHaveValue('6')
    expect(screen.getByTestId('server-faults-error')).toHaveTextContent(
      'A server takes at most 32 rules'
    )
  })

  it('keeps the form when main refuses the list, and shows that', async () => {
    mainHolds([BUSY])
    await openDialog()
    await act(async () => {
      dom.click(screen.getByTestId('server-faults-add-btn'))
    })
    type('fault-form-code', '6')
    refuseNextWrite()

    await act(async () => {
      dom.click(screen.getByTestId('fault-form-save-btn'))
    })

    expect(sets()).toHaveLength(1)
    expect(screen.getByTestId('fault-form-code')).toHaveValue('6')
    expect(screen.getByTestId('server-faults-error')).toHaveTextContent('Main refused')
  })

  it('shows a refused delete or move on the list, and leaves the list as it was', async () => {
    mainHolds([BUSY, SILENT])
    await openDialog()
    refuseNextWrite()

    await act(async () => {
      dom.click(screen.getByTestId('server-faults-rule-0-delete'))
    })

    expect(screen.getByTestId('server-faults-error')).toHaveTextContent('Main refused')
    expect(screen.getByTestId('server-faults-rule-1')).toBeInTheDocument()
  })

  it('clears the message once a write goes through', async () => {
    mainHolds([BUSY, SILENT])
    await openDialog()
    refuseNextWrite()
    await act(async () => {
      dom.click(screen.getByTestId('server-faults-rule-0-delete'))
    })

    await act(async () => {
      dom.click(screen.getByTestId('server-faults-rule-0-delete'))
    })

    expect(screen.queryByTestId('server-faults-error')).not.toBeInTheDocument()
  })

  it('takes the list that fills the limit exactly', async () => {
    mainHolds(full().slice(0, 31))
    await openDialog()
    await act(async () => {
      dom.click(screen.getByTestId('server-faults-add-btn'))
    })
    type('fault-form-code', '6')

    await act(async () => {
      dom.click(screen.getByTestId('fault-form-save-btn'))
    })

    expect((sets()[0] as { rules: unknown[] }).rules).toHaveLength(32)
    expect(screen.queryByTestId('server-faults-error')).not.toBeInTheDocument()
  })
})

describe('a write reply that arrives after the dialog moved on', () => {
  const OTHER = 'the-other-server'
  const held = (n: number): ((answer: ServerFaultWrite | undefined) => void) => {
    const release = heldWrites[n]
    if (!release) throw new Error(`no write ${n} is held`)
    return release
  }

  /** Starts a write on `UUID` that stays unanswered. */
  const startSave = async (): Promise<void> => {
    holdWrites = true
    mainHolds([BUSY])
    await openDialog()
    await act(async () => {
      dom.click(screen.getByTestId('server-faults-add-btn'))
    })
    type('fault-form-code', '6')
    await act(async () => {
      dom.click(screen.getByTestId('fault-form-save-btn'))
    })
    expect(heldWrites).toHaveLength(1)
  }

  /** A form on another server, or on this one again, with a draft in it. */
  const openFormElsewhere = async (uuid: string, closeFirst: boolean): Promise<void> => {
    await act(async () => {
      if (closeFirst) useServerFaultsDialogZustand.getState().close()
      useServerFaultsDialogZustand.getState().show(uuid)
    })
    await act(async () => {
      useServerFaultsDialogZustand.getState().edit('new')
      useServerFaultsDialogZustand.getState().setDraft({ code: '2' })
    })
  }

  const form = (): { editing: unknown; code: string; error: unknown; uuid: string } => {
    const { editing, draft, error, uuid } = useServerFaultsDialogZustand.getState()
    return { editing, code: draft.code, error, uuid }
  }

  it.each([
    ['closed and opened on another server', OTHER, true],
    ['closed and opened again', UUID, true],
    ['switched to another server without closing', OTHER, false]
  ])('does not close the form of a dialog %s, when the save is taken', async (_n, uuid, close) => {
    await startSave()
    mainHolds([])
    await openFormElsewhere(uuid, close)

    await act(async () => {
      held(0)(TAKEN)
    })

    expect(form()).toEqual({ editing: 'new', code: '2', error: undefined, uuid })
  })

  it.each([
    ['closed and opened on another server', OTHER, true],
    ['closed and opened again', UUID, true],
    ['switched to another server without closing', OTHER, false]
  ])('does not show its refusal in a dialog %s', async (_n, uuid, close) => {
    await startSave()
    mainHolds([])
    await openFormElsewhere(uuid, close)

    await act(async () => {
      held(0)(undefined)
    })

    expect(form()).toEqual({ editing: 'new', code: '2', error: undefined, uuid })
  })

  it('does not show the refusal of a delete in a dialog opened since', async () => {
    holdWrites = true
    mainHolds([BUSY, SILENT])
    await openDialog()
    await act(async () => {
      dom.click(screen.getByTestId('server-faults-rule-0-delete'))
    })
    await openFormElsewhere(OTHER, true)

    await act(async () => {
      held(0)(undefined)
    })

    expect(form().error).toBeUndefined()
  })

  it('does not show the refusal of a move in a dialog opened since', async () => {
    holdWrites = true
    mainHolds([BUSY, SILENT])
    await openDialog()
    await act(async () => {
      dom.click(screen.getByTestId('server-faults-rule-0-down'))
    })
    await openFormElsewhere(UUID, true)

    await act(async () => {
      held(0)(undefined)
    })

    expect(form().error).toBeUndefined()
  })

  it('lets a dialog opened since write while the earlier write is still out', async () => {
    await startSave()
    await openFormElsewhere(UUID, true)

    expect(screen.getByTestId('fault-form-save-btn')).toBeEnabled()
  })

  it('keeps a dialog opened since from writing twice when the earlier write answers first', async () => {
    holdWrites = true
    mainHolds([BUSY, SILENT])
    await openDialog()
    await act(async () => {
      dom.click(screen.getByTestId('server-faults-rule-0-delete'))
    })
    await act(async () => {
      useServerFaultsDialogZustand.getState().close()
      useServerFaultsDialogZustand.getState().show(UUID)
    })
    await act(async () => {
      dom.click(screen.getByTestId('server-faults-rule-0-delete'))
    })

    await act(async () => {
      held(0)(undefined)
    })

    expect(screen.getByTestId('server-faults-rule-1-delete')).toBeDisabled()
    expect(heldWrites).toHaveLength(2)
  })

  it('still closes the form and shows a refusal when nothing moved on', async () => {
    await startSave()

    await act(async () => {
      held(0)(undefined)
    })
    expect(screen.getByTestId('server-faults-error')).toHaveTextContent('Main refused')
    expect(form().editing).toBe('new')

    await act(async () => {
      dom.click(screen.getByTestId('fault-form-save-btn'))
    })
    await act(async () => {
      held(1)(TAKEN)
    })
    expect(form().editing).toBeUndefined()
  })
})

// Every write replaces main's whole list with one built from `status`, so a
// write built from a list main no longer holds brings back what was deleted
// or drops what was added. Main refuses a stale version, and the dialog does
// not offer a write until it holds the list main confirmed last.
describe('a write built from a list main no longer holds', () => {
  const NEW_RULE = { action: { kind: 'exception', code: 6 } } as const
  const deleteButtons = (): HTMLElement[] => screen.getAllByTestId(/^server-faults-rule-\d-delete$/)

  const addDraft = async (): Promise<void> => {
    await act(async () => {
      useServerFaultsDialogZustand.getState().edit('new')
    })
    type('fault-form-code', '6')
  }

  const clickSave = async (): Promise<void> => {
    await act(async () => {
      dom.click(screen.getByTestId('fault-form-save-btn'))
    })
  }

  it('does not delete again from the list the first delete replaced while the refresh is out', async () => {
    mainHolds([BUSY, SILENT])
    await openDialog()
    holdStatus = true

    await act(async () => {
      dom.click(screen.getByTestId('server-faults-rule-0-delete'))
    })
    for (const button of deleteButtons()) expect(button).toBeDisabled()
    for (const button of deleteButtons()) {
      await act(async () => {
        dom.click(button)
      })
    }
    await act(async () => {
      await useServerFaultsDialogZustand.getState().remove(0)
    })
    expect(sets()).toEqual([{ uuid: UUID, rules: [SILENT] }])

    await answerStatus(0, main)
    await act(async () => {
      dom.click(screen.getByTestId('server-faults-rule-0-delete'))
    })

    expect(sets()).toEqual([
      { uuid: UUID, rules: [SILENT] },
      { uuid: UUID, rules: [] }
    ])
    expect(main.rules).toEqual([])
  })

  it('offers no write until the first status arrives, and then adds to the list main holds', async () => {
    main = statusOf([BUSY, SILENT])
    await openDialog()

    expect(screen.getByTestId('server-faults-add-btn')).toBeDisabled()
    await addDraft()
    expect(screen.getByTestId('fault-form-save-btn')).toBeDisabled()
    await clickSave()
    await act(async () => {
      await useServerFaultsDialogZustand.getState().save()
    })
    expect(sets()).toEqual([])

    await answerStatus(0, main)
    await clickSave()

    expect(sets()).toEqual([{ uuid: UUID, rules: [BUSY, SILENT, NEW_RULE] }])
    expect(main.rules.map(ruleOfStatus)).toEqual([BUSY, SILENT, NEW_RULE])
  })

  it.each([
    ['an MCP change', [SILENT, BUSY]],
    ['an expiry', [SILENT]]
  ])(
    'does not save over %s while its refresh is out, and saves onto it after',
    async (_name, changed: ServerFaultRule[]) => {
      mainHolds([BUSY, SILENT])
      await openDialog()
      await addDraft()
      holdStatus = true
      main = statusOf(changed)
      await act(async () => {
        announce(main)
      })

      expect(screen.getByTestId('fault-form-save-btn')).toBeDisabled()
      await act(async () => {
        await useServerFaultsDialogZustand.getState().save()
      })
      expect(sets()).toEqual([])

      await answerStatus(0, main)
      await clickSave()

      expect(sets()).toEqual([{ uuid: UUID, rules: [...changed, NEW_RULE] }])
      expect(screen.queryByTestId('fault-form-code')).not.toBeInTheDocument()
    }
  )

  it('sends the version of the list it was built from', async () => {
    mainHolds([BUSY, SILENT])
    await openDialog()
    const read = main.version

    await act(async () => {
      dom.click(screen.getByTestId('server-faults-rule-1-delete'))
    })

    expect(sent()).toEqual([{ uuid: UUID, version: read, rules: [BUSY] }])
  })

  it('keeps the form and the draft when main refuses a stale version, says so, and saves onto the list it answered', async () => {
    mainHolds([BUSY])
    await openDialog()
    await addDraft()
    // Main changed the list and its server_faults has not arrived yet.
    main = statusOf([SLOW])

    await clickSave()

    expect(main.rules.map(({ action }) => action.kind)).toEqual(['delay'])
    expect(screen.getByTestId('fault-form-code')).toHaveValue('6')
    expect(screen.getByTestId('server-faults-error')).toHaveTextContent(
      'The rules changed before this write reached main, so nothing was written.'
    )
    expect(useServerFaultsDialogZustand.getState().status).toEqual(main.rules)

    await clickSave()

    expect(sets()).toEqual([
      { uuid: UUID, rules: [BUSY, NEW_RULE] },
      { uuid: UUID, rules: [SLOW, NEW_RULE] }
    ])
    expect(screen.queryByTestId('server-faults-error')).not.toBeInTheDocument()
  })

  it('shows the list main answered when it refuses a stale delete', async () => {
    mainHolds([BUSY, SILENT])
    await openDialog()
    main = statusOf([SLOW])

    await act(async () => {
      dom.click(screen.getByTestId('server-faults-rule-0-delete'))
    })

    expect(screen.getByTestId('server-faults-rule-0-summary')).toHaveTextContent('reads')
    expect(screen.queryByTestId('server-faults-rule-1')).not.toBeInTheDocument()
    expect(screen.getByTestId('server-faults-error')).toHaveTextContent('The rules changed')
    expect(main.rules.map(({ action }) => action.kind)).toEqual(['delay'])
  })

  it('runs one write at a time, and builds the next from the list the first confirmed', async () => {
    mainHolds([BUSY, SILENT, SLOW])
    await openDialog()
    holdWrites = true

    await act(async () => {
      dom.click(screen.getByTestId('server-faults-rule-0-delete'))
    })
    for (const button of deleteButtons()) expect(button).toBeDisabled()
    expect(screen.getByTestId('server-faults-rule-1-up')).toBeDisabled()
    await act(async () => {
      await useServerFaultsDialogZustand.getState().move(2, -1)
    })
    expect(heldWrites).toHaveLength(1)

    const first = sent()[0]
    if (!first) throw new Error('the first delete was not sent')
    const release = heldWrites[0]
    if (!release) throw new Error('the first delete is not held')
    await act(async () => {
      release(mainWrites(first))
    })
    holdWrites = false
    await act(async () => {
      dom.click(screen.getByTestId('server-faults-rule-0-delete'))
    })

    expect(sets()).toEqual([
      { uuid: UUID, rules: [SILENT, SLOW] },
      { uuid: UUID, rules: [SLOW] }
    ])
    expect(main.rules.map(({ action }) => action.kind)).toEqual(['delay'])
  })
})

// Main answers a deleted server's status with an empty list at a current
// version, so the version alone would let the dialog write rules back onto it.
describe('a server deleted while its dialog is open', () => {
  const DELETED_MESSAGE = 'This server was deleted, so its fault rules cannot be changed.'

  /** Main deletes the server: an empty list at a new version, which no longer exists. */
  const mainDeletesTheServer = (): void => {
    main = { ...statusOf([]), exists: false }
  }

  const openForm = async (): Promise<void> => {
    mainHolds([BUSY])
    await openDialog()
    await act(async () => {
      dom.click(screen.getByTestId('server-faults-add-btn'))
    })
    type('fault-form-code', '6')
  }

  it('closes the form and drops its draft once the refresh says so, and offers no write', async () => {
    await openForm()

    mainDeletesTheServer()
    await act(async () => {
      announce(main)
    })

    expect(screen.queryByTestId('fault-form-code')).not.toBeInTheDocument()
    expect(useServerFaultsDialogZustand.getState().draft.code).toBe('')
    expect(screen.getByTestId('server-faults-error')).toHaveTextContent(DELETED_MESSAGE)
    expect(screen.getByTestId('server-faults-add-btn')).toBeDisabled()
    expect(screen.getByTestId('server-faults-clear-all-btn')).toBeDisabled()

    await act(async () => {
      useServerFaultsDialogZustand.getState().edit('new')
      useServerFaultsDialogZustand.getState().setDraft({ code: '6' })
    })
    expect(screen.getByTestId('fault-form-save-btn')).toBeDisabled()
    await act(async () => {
      await useServerFaultsDialogZustand.getState().save()
    })
    expect(sets()).toEqual([])
  })

  it('closes the form and drops its draft when main refuses the save because the server is gone', async () => {
    await openForm()
    // Deleted, and its server_faults has not arrived yet.
    mainDeletesTheServer()

    await act(async () => {
      dom.click(screen.getByTestId('fault-form-save-btn'))
    })

    expect(sets()).toEqual([
      { uuid: UUID, rules: [BUSY, { action: { kind: 'exception', code: 6 } }] }
    ])
    expect(main.rules).toEqual([])
    expect(screen.queryByTestId('fault-form-code')).not.toBeInTheDocument()
    expect(useServerFaultsDialogZustand.getState().draft.code).toBe('')
    expect(screen.getByTestId('server-faults-error')).toHaveTextContent(DELETED_MESSAGE)
    expect(screen.getByTestId('server-faults-add-btn')).toBeDisabled()
  })

  it('takes writes again once a refresh finds the server restored by undo', async () => {
    await openForm()
    mainDeletesTheServer()
    await act(async () => {
      announce(main)
    })

    mainHolds([])
    await act(async () => {
      dom.click(screen.getByTestId('server-faults-refresh-btn'))
    })

    expect(screen.queryByTestId('server-faults-error')).not.toBeInTheDocument()
    expect(screen.getByTestId('server-faults-add-btn')).toBeEnabled()
  })
})
