// @vitest-environment happy-dom
//
// The store asks main for every server's rules once, when the window loads, and
// hears `server_faults` from then on. An event that arrives while that question
// is in flight is newer than the answer, and the answer may not overwrite it.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ServerFaultRule } from '@shared'
import { fireEvent, stubRenderer } from './stubRenderer'

const NO_RESPONSE = { kind: 'no_response' } as const
const BUSY = { kind: 'exception', code: 6 } as const

type Snapshot = Record<string, ServerFaultRule[]>

interface LoadedStore {
  rules: () => Snapshot
  answerSnapshot: (snapshot: Snapshot) => Promise<void>
}

/** Loads the store with `get_server_faults` held open, and hands back how to answer it. */
const loadWithSnapshotPending = async (): Promise<LoadedStore> => {
  vi.resetModules()
  stubRenderer()
  let answer: (snapshot: Snapshot) => void = () => undefined
  const pending = new Promise<Snapshot>((resolve) => {
    answer = resolve
  })
  const underneath = window.api as unknown as Record<string, unknown>
  window.api = new Proxy(
    {},
    {
      get: (_target, name: string): unknown =>
        name === 'getServerFaults' ? (): Promise<Snapshot> => pending : underneath[name]
    }
  ) as never
  const { useServerFaultsZustand } = await import('../serverFaults.zustand')
  return {
    rules: (): Snapshot => useServerFaultsZustand.getState().rules,
    answerSnapshot: async (snapshot: Snapshot): Promise<void> => {
      answer(snapshot)
      await pending
      await Promise.resolve()
    }
  }
}

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('the snapshot a window loads with', () => {
  it('fills every server no event has spoken for', async () => {
    const store = await loadWithSnapshotPending()

    await store.answerSnapshot({ a: [{ action: NO_RESPONSE }] })

    expect(store.rules()).toEqual({ a: [{ action: NO_RESPONSE }] })
  })

  it('keeps rules an event set while it was in flight', async () => {
    const store = await loadWithSnapshotPending()

    fireEvent('server_faults', { uuid: 'a', rules: [{ action: BUSY }] })
    await store.answerSnapshot({})

    expect(store.rules()).toEqual({ a: [{ action: BUSY }] })
  })

  it('keeps a clear an event announced while it was in flight', async () => {
    const store = await loadWithSnapshotPending()

    fireEvent('server_faults', { uuid: 'a', rules: [] })
    await store.answerSnapshot({ a: [{ action: BUSY }], b: [{ action: NO_RESPONSE }] })

    expect(store.rules()).toEqual({ a: [], b: [{ action: NO_RESPONSE }] })
  })

  it('keeps an expiry an event announced while it was in flight', async () => {
    const store = await loadWithSnapshotPending()

    fireEvent('server_faults', { uuid: 'a', rules: [{ action: NO_RESPONSE }] })
    await store.answerSnapshot({
      a: [{ forSeconds: 1, action: BUSY }, { action: NO_RESPONSE }]
    })

    expect(store.rules()).toEqual({ a: [{ action: NO_RESPONSE }] })
  })

  it('takes the events that come after it', async () => {
    const store = await loadWithSnapshotPending()
    fireEvent('server_faults', { uuid: 'a', rules: [{ action: BUSY }] })
    await store.answerSnapshot({})

    fireEvent('server_faults', { uuid: 'a', rules: [] })

    expect(store.rules()).toEqual({ a: [] })
  })
})
