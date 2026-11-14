// @vitest-environment happy-dom
/// <reference types="@testing-library/jest-dom/vitest" />
import { cleanup, fireEvent as dom, render, screen, within } from '@testing-library/react'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ServerFaultRule, ServerFaultRuleStatus } from '@shared'

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

const statusOf = (rules: ServerFaultRule[]): ServerFaultRuleStatus[] =>
  rules.map((rule, i) => ({
    ...rule,
    matched: 10 + i,
    triggered: 5 + i,
    ...(rule.forSeconds !== undefined && { expiresAt: Date.now() + rule.forSeconds * 1000 })
  }))

/** What `get_server_fault_status` answers next, one reply per call, each held until released. */
let pending: Array<(status: ServerFaultRuleStatus[]) => void> = []
let answerNow: ServerFaultRuleStatus[] | undefined

stubRenderer()
{
  const underneath = window.api as unknown as Record<string, unknown>
  window.api = new Proxy(
    {},
    {
      get: (_target, name: string): unknown =>
        name === 'getServerFaultStatus'
          ? (): Promise<ServerFaultRuleStatus[]> =>
              answerNow
                ? Promise.resolve(answerNow)
                : new Promise((resolve) => {
                    pending.push(resolve)
                  })
          : underneath[name]
    }
  ) as never
}
const calls: ApiCall[] = []
recordApiCalls(calls)

const { useServerFaultsDialogZustand } = await import('../serverFaultsDialog.zustand')
const ServerFaultsDialog = (await import('../ServerFaultsDialog')).default

/** Opens the dialog for `UUID` and lets the status request go out. */
const openDialog = async (): Promise<void> => {
  render(<ServerFaultsDialog />)
  await act(async () => {
    useServerFaultsDialogZustand.getState().show(UUID)
  })
}

const sets = (): unknown[] =>
  calls.filter(({ method }) => method === 'setServerFaults').map(({ payload }) => payload)

beforeEach(() => {
  calls.length = 0
  pending = []
  answerNow = undefined
  useServerFaultsDialogZustand.getState().close()
})

afterEach(cleanup)

describe('what the dialog shows', () => {
  it('asks main for the status of the server it was opened for, and shows one row per rule', async () => {
    answerNow = statusOf([BUSY, SILENT, SLOW])

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
    answerNow = statusOf([BUSY, SILENT, SLOW])

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
    answerNow = []

    await openDialog()

    expect(screen.getByTestId('server-faults-empty')).toBeInTheDocument()
    expect(screen.getByTestId('server-faults-clear-all-btn')).toBeDisabled()
  })

  it('says in one line that a change starts every count and clock over', async () => {
    answerNow = []

    await openDialog()

    expect(screen.getByTestId('server-faults-dialog')).toHaveTextContent(
      'Every change replaces the whole list: all counts and “for seconds” clocks start over.'
    )
  })

  it('reads again when refresh is pressed, and shows the new counts', async () => {
    answerNow = statusOf([BUSY])
    await openDialog()
    answerNow = [{ ...BUSY, matched: 99, triggered: 98 }]

    await act(async () => {
      dom.click(screen.getByTestId('server-faults-refresh-btn'))
    })

    expect(screen.getByTestId('server-faults-rule-0-counts')).toHaveTextContent(
      'triggered 98 / matched 99'
    )
  })

  it('reads again when server_faults names its server, and not when it names another', async () => {
    answerNow = statusOf([BUSY])
    await openDialog()
    calls.length = 0

    await act(async () => {
      fireEvent('server_faults', { uuid: 'another-server', rules: [] })
    })
    expect(calls).toEqual([])

    await act(async () => {
      fireEvent('server_faults', { uuid: UUID, rules: [BUSY] })
    })
    expect(calls).toEqual([{ method: 'getServerFaultStatus', payload: UUID }])
  })

  it('does not ask while the dialog is closed', () => {
    fireEvent('server_faults', { uuid: UUID, rules: [BUSY] })

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
      fireEvent('server_faults', { uuid: UUID, rules: [SILENT, SLOW] })
    })
    expect(pending).toHaveLength(2)
    await act(async () => {
      pending[1]?.(NEW)
    })
    await act(async () => {
      pending[0]?.(OLD)
    })

    expect(screen.getByTestId('server-faults-rule-0-summary')).toHaveTextContent('coils')
    expect(screen.queryByTestId('server-faults-rule-2')).not.toBeInTheDocument()
    expect(screen.getAllByTestId(/^server-faults-rule-\d$/)).toHaveLength(2)
  })

  it('does not put its rules on screen while the newer request is still out', async () => {
    await openDialog()
    await act(async () => {
      fireEvent('server_faults', { uuid: UUID, rules: [] })
    })

    await act(async () => {
      pending[0]?.(OLD)
    })

    expect(screen.queryByTestId('server-faults-rule-0')).not.toBeInTheDocument()
  })

  it('keeps the newest reply when two refresh presses answer out of order', async () => {
    await openDialog()
    await act(async () => {
      dom.click(screen.getByTestId('server-faults-refresh-btn'))
    })

    await act(async () => {
      pending[1]?.(NEW)
    })
    await act(async () => {
      pending[0]?.(OLD)
    })

    expect(screen.getAllByTestId(/^server-faults-rule-\d$/)).toHaveLength(2)
  })

  it('still shows an answer that nothing overtook', async () => {
    await openDialog()

    await act(async () => {
      pending[0]?.(OLD)
    })

    expect(screen.getByTestId('server-faults-rule-0-summary')).toHaveTextContent('unit 4')
  })

  it('does not write into a dialog that closed and opened on another server', async () => {
    await openDialog()
    await act(async () => {
      useServerFaultsDialogZustand.getState().close()
      useServerFaultsDialogZustand.getState().show('the-other-server')
    })

    await act(async () => {
      pending[0]?.(OLD)
    })
    expect(screen.queryByTestId('server-faults-rule-0')).not.toBeInTheDocument()

    await act(async () => {
      pending[1]?.(NEW)
    })
    expect(screen.getAllByTestId(/^server-faults-rule-\d$/)).toHaveLength(2)
  })
})

describe('the buttons that change the list', () => {
  const THREE = [BUSY, SILENT, SLOW]

  beforeEach(() => {
    answerNow = statusOf(THREE)
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
    answerNow = statusOf(Array.from({ length: 32 }, () => BUSY))

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
    answerNow = statusOf([BUSY, SILENT])
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
