/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { describe, expect, it } from 'vitest'
import { FAULT_DELAY_MAX_MS, MAIN_SERVER_UUID, MAX_FAULT_RULES } from '@shared'
import { connectInMemory, fakeContext, jsonOf, textOf } from './fakeContext'

const NO_RESPONSE = { kind: 'no_response' } as const
const FAULT_TOOLS = [
  'server_set_faults',
  'server_get_faults',
  'server_clear_faults',
  'server_drop_connections'
]

describe('the fault tools', () => {
  it('are listed, closed world, and only server_get_faults read only', async () => {
    const client = await connectInMemory(fakeContext())

    const { tools } = await client.listTools()
    const annotationsOf = (name: string) => tools.find((tool) => tool.name === name)?.annotations

    expect(annotationsOf('server_get_faults')).toMatchObject({
      readOnlyHint: true,
      openWorldHint: false
    })
    for (const name of ['server_set_faults', 'server_clear_faults', 'server_drop_connections']) {
      expect(annotationsOf(name)).toMatchObject({ readOnlyHint: false, openWorldHint: false })
    }
  })

  // "Allow writes to devices" is off in a fresh fake context.
  it.each(FAULT_TOOLS)('answers %s with writes to devices switched off', async (name) => {
    const client = await connectInMemory(fakeContext())

    const result = await client.callTool({
      name,
      arguments: name === 'server_set_faults' ? { rules: [] } : {}
    })

    expect(result.isError).toBeUndefined()
  })

  it.each(FAULT_TOOLS)('refuses %s for a uuid main does not serve', async (name) => {
    const client = await connectInMemory(fakeContext())

    const result = await client.callTool({
      name,
      arguments: { uuid: 'nobody', ...(name === 'server_set_faults' && { rules: [] }) }
    })

    expect(result.isError).toBe(true)
    expect(textOf(result)).toBe('No server has uuid nobody. server_list answers the uuids.')
  })
})

describe('server_set_faults', () => {
  it('replaces the main server’s list without a uuid, and answers it', async () => {
    const context = fakeContext()
    context.serverFaults.set(MAIN_SERVER_UUID, [{ unitId: 9, action: NO_RESPONSE }])
    const client = await connectInMemory(context)
    const rules = [
      { unitId: 1, addressRange: [0, 9], direction: 'read', action: { kind: 'delay', ms: 200 } },
      { registerType: 'coils', everyNth: 3, forSeconds: 60, action: { kind: 'exception', code: 6 } }
    ]

    const result = await client.callTool({ name: 'server_set_faults', arguments: { rules } })

    expect(jsonOf(result)).toEqual({ uuid: MAIN_SERVER_UUID, rules })
    expect(context.serverFaults.list(MAIN_SERVER_UUID)).toEqual(rules)
  })

  it('sets the list of the server the uuid names, and no other', async () => {
    const context = fakeContext()
    context.knownServers.add('second')
    const client = await connectInMemory(context)

    await client.callTool({
      name: 'server_set_faults',
      arguments: { uuid: 'second', rules: [{ action: NO_RESPONSE }] }
    })

    expect(context.serverFaults.list('second')).toEqual([{ action: NO_RESPONSE }])
    expect(context.serverFaults.list(MAIN_SERVER_UUID)).toEqual([])
  })

  it.each([
    ['a delay past the ceiling', { action: { kind: 'delay', ms: FAULT_DELAY_MAX_MS + 1 } }],
    ['exception code 0', { action: { kind: 'exception', code: 0 } }],
    ['a range that starts after it ends', { addressRange: [10, 9], action: NO_RESPONSE }],
    ['an address past 65535', { addressRange: [0, 65536], action: NO_RESPONSE }],
    ['everyNth 0', { everyNth: 0, action: NO_RESPONSE }],
    ['an unknown action', { action: { kind: 'crc_error' } }]
  ])('refuses %s and keeps the list it had', async (_name, rule) => {
    const context = fakeContext()
    context.serverFaults.set(MAIN_SERVER_UUID, [{ unitId: 9, action: NO_RESPONSE }])
    const client = await connectInMemory(context)

    const result = await client.callTool({
      name: 'server_set_faults',
      arguments: { rules: [rule] }
    })

    expect(result.isError).toBe(true)
    expect(context.serverFaults.list(MAIN_SERVER_UUID)).toEqual([
      { unitId: 9, action: NO_RESPONSE }
    ])
  })

  it(`takes ${MAX_FAULT_RULES} rules and refuses one more`, async () => {
    const context = fakeContext()
    const client = await connectInMemory(context)
    const rules = (count: number) => Array.from({ length: count }, () => ({ action: NO_RESPONSE }))

    const most = await client.callTool({
      name: 'server_set_faults',
      arguments: { rules: rules(MAX_FAULT_RULES) }
    })
    const tooMany = await client.callTool({
      name: 'server_set_faults',
      arguments: { rules: rules(MAX_FAULT_RULES + 1) }
    })

    expect(most.isError).toBeUndefined()
    expect(tooMany.isError).toBe(true)
  })
})

describe('server_get_faults', () => {
  it('answers each rule with what it matched and decided', async () => {
    const context = fakeContext()
    context.serverFaults.set(MAIN_SERVER_UUID, [{ everyNth: 2, action: NO_RESPONSE }])
    const request = {
      unitId: 1,
      registerType: 'coils' as const,
      address: 0,
      count: 1,
      direction: 'read' as const
    }
    context.serverFaults.decide(MAIN_SERVER_UUID, request)
    context.serverFaults.decide(MAIN_SERVER_UUID, request)
    context.serverFaults.decide(MAIN_SERVER_UUID, request)
    const client = await connectInMemory(context)

    const result = await client.callTool({ name: 'server_get_faults', arguments: {} })

    expect(jsonOf(result)).toEqual({
      uuid: MAIN_SERVER_UUID,
      rules: [{ everyNth: 2, action: NO_RESPONSE, matched: 3, triggered: 1 }]
    })
  })
})

describe('server_clear_faults', () => {
  it('empties the list', async () => {
    const context = fakeContext()
    context.serverFaults.set(MAIN_SERVER_UUID, [{ action: NO_RESPONSE }])
    const client = await connectInMemory(context)

    const result = await client.callTool({ name: 'server_clear_faults', arguments: {} })

    expect(jsonOf(result)).toEqual({ uuid: MAIN_SERVER_UUID, rules: [] })
    expect(context.serverFaults.list(MAIN_SERVER_UUID)).toEqual([])
  })
})

describe('server_drop_connections', () => {
  it('answers how many connections the server closed', async () => {
    const context = fakeContext()
    context.dropConnections.mockReturnValue({ dropped: 2 })
    const client = await connectInMemory(context)

    const result = await client.callTool({ name: 'server_drop_connections', arguments: {} })

    expect(jsonOf(result)).toEqual({ uuid: MAIN_SERVER_UUID, dropped: 2 })
    expect(context.dropConnections).toHaveBeenCalledWith(MAIN_SERVER_UUID)
  })

  it('answers the server’s refusal as an error', async () => {
    const context = fakeContext()
    context.dropConnections.mockReturnValue({
      error: 'The server runs on RTU, which has no connections to drop'
    })
    const client = await connectInMemory(context)

    const result = await client.callTool({ name: 'server_drop_connections', arguments: {} })

    expect(result.isError).toBe(true)
    expect(textOf(result)).toBe('The server runs on RTU, which has no connections to drop')
  })
})
