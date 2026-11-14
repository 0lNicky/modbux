/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { describe, expect, it } from 'vitest'
import { MAIN_SERVER_UUID } from '@shared'
import type { ServerRequest } from '../../modbusServer/requestLog'
import { MAIN_WINDOW_CLOSED } from '../registry'
import { connectInMemory, fakeContext, jsonOf, textOf } from './fakeContext'

const request = (overrides: Partial<ServerRequest>): ServerRequest => ({
  timestamp: 1000,
  uuid: MAIN_SERVER_UUID,
  unitId: 1,
  direction: 'read',
  registerType: 'holding_registers',
  address: 0,
  count: 1,
  outcome: 'ok',
  ...overrides
})

const addressesOf = (result: unknown) =>
  (jsonOf(result).requests as ServerRequest[]).map(({ address }) => address)

describe('server_get_requests', () => {
  it('is listed read only and closed world', async () => {
    const client = await connectInMemory(fakeContext())

    const { tools } = await client.listTools()

    expect(tools.find((tool) => tool.name === 'server_get_requests')?.annotations).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false
    })
  })

  it('answers the main server without a uuid', async () => {
    const context = fakeContext()
    context.serverRequests.record(request({ address: 1 }))
    context.serverRequests.record(request({ uuid: 'other', address: 2 }))
    const client = await connectInMemory(context)

    const result = await client.callTool({ name: 'server_get_requests', arguments: {} })

    expect(result.isError).toBeUndefined()
    expect(jsonOf(result).uuid).toBe(MAIN_SERVER_UUID)
    expect(addressesOf(result)).toEqual([1])
  })

  it('answers the server the uuid names', async () => {
    const context = fakeContext()
    context.serverRequests.record(request({ address: 1 }))
    context.serverRequests.record(request({ uuid: 'other', address: 2 }))
    const client = await connectInMemory(context)

    const result = await client.callTool({
      name: 'server_get_requests',
      arguments: { uuid: 'other' }
    })

    expect(addressesOf(result)).toEqual([2])
  })

  it('answers the newest 50 by default', async () => {
    const context = fakeContext()
    for (let address = 0; address < 60; address++)
      context.serverRequests.record(request({ address }))
    const client = await connectInMemory(context)

    const result = await client.callTool({ name: 'server_get_requests', arguments: {} })

    const addresses = addressesOf(result)
    expect(addresses).toHaveLength(50)
    expect(addresses[0]).toBe(10)
  })

  it.each([
    [{ limit: 2 }, [3, 4]],
    [{ sinceTimestamp: 300 }, [3, 4]],
    [{ failedOnly: true }, [1, 3]]
  ])('passes %j to the log', async (filter, addresses) => {
    const context = fakeContext()
    context.serverRequests.record(request({ address: 1, timestamp: 100, outcome: 'no_response' }))
    context.serverRequests.record(request({ address: 2, timestamp: 200, outcome: 'ok' }))
    context.serverRequests.record(
      request({ address: 3, timestamp: 300, outcome: 'exception', exceptionCode: 2 })
    )
    context.serverRequests.record(request({ address: 4, timestamp: 400, outcome: 'ok' }))
    const client = await connectInMemory(context)

    const result = await client.callTool({ name: 'server_get_requests', arguments: filter })

    expect(addressesOf(result)).toEqual(addresses)
  })

  it('refuses a limit of 0', async () => {
    const client = await connectInMemory(fakeContext())

    const result = await client.callTool({ name: 'server_get_requests', arguments: { limit: 0 } })

    expect(result.isError).toBe(true)
  })

  it('answers an error with the main window closed', async () => {
    const context = fakeContext()
    context.setMainWindowOpen(false)
    const client = await connectInMemory(context)

    const result = await client.callTool({ name: 'server_get_requests', arguments: {} })

    expect(result.isError).toBe(true)
    expect(textOf(result)).toBe(MAIN_WINDOW_CLOSED)
  })
})
