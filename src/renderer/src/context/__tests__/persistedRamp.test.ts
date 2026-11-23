// @vitest-environment happy-dom
//
// A ramp register that `RegisterParamsSchema` refuses cost the `registers` of
// its whole server when the store came up at its own version, because
// `repairServers` reads a server field by field and `registers` is one field.
// Review Focus 4 of the ramp plan: that one register goes and the rest stay.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CURRENT_SERVER_ZUSTAND_VERSION, SERVER_ZUSTAND_STORAGE_KEY } from '@shared'
import { stubRenderer } from './stubRenderer'

const base = { registerType: 'holding_registers', dataType: 'uint16', comment: '' }

const fixedAt2 = { value: 7, params: { ...base, address: 2, value: 7 } }

/** A ramp with no step, which the schema refuses. */
const rampWithoutStepAt0 = {
  value: 0,
  params: { ...base, address: 0, min: 0, max: 10, interval: 1000, mode: 'ramp', start: 0 }
}

/** A random generator whose min a uint16 cannot hold. */
const outOfRangeMinAt0 = {
  value: 0,
  params: { ...base, address: 0, min: -1, max: 10, interval: 1000 }
}

const persisted = (atAddress0: unknown): string =>
  JSON.stringify({
    state: {
      selectedUuid: 'u',
      servers: {
        u: {
          port: '502',
          unitId: '1',
          littleEndian: false,
          byteSwap: false,
          registers: {
            '1': {
              coils: {},
              discrete_inputs: {},
              input_registers: {},
              holding_registers: { '0': atAddress0, '2': fixedAt2 }
            }
          },
          usedAddresses: { '1': { input_registers: [], holding_registers: [0, 2] } }
        }
      }
    },
    version: CURRENT_SERVER_ZUSTAND_VERSION
  })

beforeEach(() => {
  vi.resetModules()
  localStorage.clear()
  stubRenderer()
})

describe('a store at its own version holding a ramp the schema refuses', () => {
  it('comes up without that ramp, with the rest of its server and its address free', async () => {
    localStorage.setItem(SERVER_ZUSTAND_STORAGE_KEY, persisted(rampWithoutStepAt0))

    const { useServerZustand } = await import('../server.zustand')
    const server = useServerZustand.getState().servers.u

    expect(Object.keys(server?.registers['1']?.holding_registers ?? {})).toEqual(['2'])
    expect(server?.usedAddresses['1']?.holding_registers).toEqual([2])
    expect(useServerZustand.getState().configReset).toBeUndefined()
  })

  // The drop is for a ramp alone. Any other register the schema refuses costs
  // the server's registers as it did before.
  it('still resets the registers of a server holding an out-of-range min', async () => {
    localStorage.setItem(SERVER_ZUSTAND_STORAGE_KEY, persisted(outOfRangeMinAt0))

    const { useServerZustand } = await import('../server.zustand')

    expect(useServerZustand.getState().servers.u?.registers).toEqual({})
    expect(useServerZustand.getState().configReset?.fields).toContain('registers')
  })
})
