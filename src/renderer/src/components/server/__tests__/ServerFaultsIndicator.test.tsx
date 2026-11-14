// @vitest-environment happy-dom
/// <reference types="@testing-library/jest-dom/vitest" />
import { fireEvent as click, render, screen } from '@testing-library/react'
import { act } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MAIN_SERVER_UUID } from '@shared'

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

const SECOND_UUID = 'the-server-on-503'
const NO_RESPONSE = { kind: 'no_response' } as const
/** What main holds when the window loads, as `get_server_faults` answers it. */
const HELD_AT_LOAD = { [SECOND_UUID]: [{ unitId: 4, action: NO_RESPONSE }] }

stubRenderer()
{
  const underneath = window.api as unknown as Record<string, unknown>
  window.api = new Proxy(
    {},
    {
      get: (_target, name: string): unknown =>
        name === 'getServerFaults'
          ? (): Promise<typeof HELD_AT_LOAD> => Promise.resolve(HELD_AT_LOAD)
          : underneath[name]
    }
  ) as never
}
const calls: ApiCall[] = []
recordApiCalls(calls)

const { useServerZustand } = await import('@renderer/context/server.zustand')
const { useServerFaultsZustand } = await import('@renderer/context/serverFaults.zustand')
const ServerFaultsIndicator = (await import('../ServerFaultsIndicator')).default
await Promise.resolve()
const rulesAfterLoad = useServerFaultsZustand.getState().rules

beforeEach(() => {
  calls.length = 0
  useServerZustand.setState({ selectedUuid: MAIN_SERVER_UUID })
  useServerFaultsZustand.setState({ rules: {} })
})

describe('the fault rule store', () => {
  it('holds what main answers when the window loads', () => {
    expect(rulesAfterLoad).toEqual(HELD_AT_LOAD)
  })

  it('takes one server’s list from server_faults and keeps the others', () => {
    act(() => {
      fireEvent('server_faults', { uuid: SECOND_UUID, rules: [{ action: NO_RESPONSE }] })
      fireEvent('server_faults', {
        uuid: MAIN_SERVER_UUID,
        rules: [{ unitId: 1, action: NO_RESPONSE }]
      })
      fireEvent('server_faults', { uuid: SECOND_UUID, rules: [] })
    })

    expect(useServerFaultsZustand.getState().rules).toEqual({
      [MAIN_SERVER_UUID]: [{ unitId: 1, action: NO_RESPONSE }],
      [SECOND_UUID]: []
    })
  })
})

describe('the fault indicator', () => {
  it('draws nothing while the shown server has no rules', () => {
    useServerFaultsZustand.setState({ rules: { [SECOND_UUID]: [{ action: NO_RESPONSE }] } })

    render(<ServerFaultsIndicator />)

    expect(screen.queryByTestId('server-faults-indicator')).not.toBeInTheDocument()
    expect(screen.queryByTestId('server-faults-clear-btn')).not.toBeInTheDocument()
  })

  it('counts the shown server’s rules', () => {
    render(<ServerFaultsIndicator />)

    act(() => {
      fireEvent('server_faults', {
        uuid: MAIN_SERVER_UUID,
        rules: [{ action: NO_RESPONSE }, { unitId: 2, action: NO_RESPONSE }]
      })
    })
    expect(screen.getByTestId('server-faults-indicator')).toHaveTextContent('2 fault rules')

    act(() => {
      fireEvent('server_faults', { uuid: MAIN_SERVER_UUID, rules: [{ action: NO_RESPONSE }] })
    })
    expect(screen.getByTestId('server-faults-indicator')).toHaveTextContent('1 fault rule')
  })

  it('follows the selection to another server’s rules', () => {
    useServerFaultsZustand.setState({ rules: { [SECOND_UUID]: [{ action: NO_RESPONSE }] } })
    render(<ServerFaultsIndicator />)

    act(() => {
      useServerZustand.setState({ selectedUuid: SECOND_UUID })
    })

    expect(screen.getByTestId('server-faults-indicator')).toHaveTextContent('1 fault rule')
  })

  it('asks main to clear the shown server’s rules, and goes once main says they are gone', () => {
    useServerFaultsZustand.setState({ rules: { [SECOND_UUID]: [{ action: NO_RESPONSE }] } })
    useServerZustand.setState({ selectedUuid: SECOND_UUID })
    render(<ServerFaultsIndicator />)

    click.click(screen.getByTestId('server-faults-clear-btn'))
    expect(calls).toEqual([{ method: 'clearServerFaults', payload: SECOND_UUID }])

    act(() => {
      fireEvent('server_faults', { uuid: SECOND_UUID, rules: [] })
    })
    expect(screen.queryByTestId('server-faults-indicator')).not.toBeInTheDocument()
  })
})
