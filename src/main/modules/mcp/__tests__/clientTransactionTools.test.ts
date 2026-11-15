/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { describe, expect, it } from 'vitest'
import type { Transaction } from '@shared'
import type { LoggedTransaction } from '../../modbusClient/transactionLog'
import { connectInMemory, fakeContext, jsonOf } from './fakeContext'

const transaction = (overrides: Partial<LoggedTransaction> = {}): LoggedTransaction => ({
  id: '1__a',
  timestamp: 1000,
  unitId: 7,
  address: 0,
  code: 3,
  responseLength: 1,
  timeout: false,
  request: '07 03 00 00 00 01',
  responses: ['07 03 02 00 64'],
  durationMs: 12,
  ...overrides
})

const exception: Partial<Transaction> & { exceptionCode: number } = {
  errorMessage: 'Gateway target device failed to respond',
  responses: ['07 83 0B'],
  exceptionCode: 11
}

const connected = () => {
  const context = fakeContext()
  context.setClientState({ connectState: 'connected' })
  return context
}

describe('client_get_transactions', () => {
  it('is read only', async () => {
    const client = await connectInMemory(connected())

    const { tools } = await client.listTools()

    expect(
      tools.find((tool) => tool.name === 'client_get_transactions')?.annotations
    ).toMatchObject({ readOnlyHint: true })
  })

  it('answers the transactions with their exceptionCode, durationMs and frames', async () => {
    const context = connected()
    context.logTransaction(transaction())
    context.logTransaction(transaction({ timestamp: 2000, ...exception }))
    const client = await connectInMemory(context)

    const result = jsonOf(await client.callTool({ name: 'client_get_transactions', arguments: {} }))

    expect(result.count).toBe(2)
    expect(result.transactions).toEqual([
      expect.objectContaining({ request: '07 03 00 00 00 01', durationMs: 12 }),
      expect.objectContaining({ exceptionCode: 11, responses: ['07 83 0B'], timestamp: 2000 })
    ])
  })

  it('asks for 50 unless told otherwise', async () => {
    const context = connected()
    const client = await connectInMemory(context)

    await client.callTool({ name: 'client_get_transactions', arguments: {} })

    expect(context.transactions).toHaveBeenLastCalledWith({
      limit: 50,
      sinceTimestamp: undefined,
      failedOnly: false
    })
  })

  it('passes limit, sinceTimestamp and failedOnly through, and answers what matches', async () => {
    const context = connected()
    context.logTransaction(transaction({ timestamp: 1000, ...exception }))
    context.logTransaction(transaction({ timestamp: 2000 }))
    context.logTransaction(transaction({ timestamp: 3000, ...exception }))
    const client = await connectInMemory(context)

    const result = jsonOf(
      await client.callTool({
        name: 'client_get_transactions',
        arguments: { failedOnly: true, sinceTimestamp: 1500, limit: 5 }
      })
    )

    expect(result.transactions).toEqual([expect.objectContaining({ timestamp: 3000 })])
  })

  it('refuses a limit of 0', async () => {
    const client = await connectInMemory(connected())

    const result = await client.callTool({
      name: 'client_get_transactions',
      arguments: { limit: 0 }
    })

    expect(result.isError).toBe(true)
  })
})

describe('the failure of client_read_points', () => {
  const failingRead = (context: ReturnType<typeof connected>) => {
    context.read.mockImplementation(async () => {
      context.logTransaction(transaction({ timestamp: 5000, ...exception }))
      return {
        read: true,
        data: [],
        groups: [[0, 1]],
        errors: [{ group: [0, 1], message: 'Gateway target device failed to respond' }]
      }
    })
  }

  it('carries the failed transactions logged during the call, with exceptionCode', async () => {
    const context = connected()
    context.logTransaction(transaction({ timestamp: 10, ...exception, unitId: 99 }))
    failingRead(context)
    const client = await connectInMemory(context)

    const result = await client.callTool({ name: 'client_read_points', arguments: {} })

    expect(result.isError).toBe(true)
    // The failure logged before the call is not this call's.
    expect(jsonOf(result).failedTransactions).toEqual([
      expect.objectContaining({ timestamp: 5000, exceptionCode: 11, unitId: 7 })
    ])
  })

  it('leaves out a transaction that succeeded during the call', async () => {
    const context = connected()
    context.read.mockImplementation(async () => {
      context.logTransaction(transaction({ timestamp: 5000 }))
      context.logTransaction(transaction({ timestamp: 5001, ...exception }))
      return {
        read: true,
        data: [],
        groups: [[0, 1]],
        errors: [{ group: [0, 1], message: 'x' }]
      }
    })
    const client = await connectInMemory(context)

    const result = jsonOf(await client.callTool({ name: 'client_read_points', arguments: {} }))

    expect(result.failedTransactions).toEqual([expect.objectContaining({ timestamp: 5001 })])
  })

  it('adds nothing to a successful read', async () => {
    const context = connected()
    context.logTransaction(transaction({ timestamp: 1, ...exception }))
    const client = await connectInMemory(context)

    const result = await client.callTool({ name: 'client_read_points', arguments: {} })

    expect(result.isError).toBeUndefined()
    expect(jsonOf(result)).not.toHaveProperty('failedTransactions')
  })
})

describe('the failure of client_write', () => {
  const writable = () => {
    const context = connected()
    context.setAllowWrites(true)
    return context
  }
  const args = { address: 0, registerType: 'holding_registers', words: [1] }

  it('carries the failed transactions logged during the call, with exceptionCode', async () => {
    const context = writable()
    context.logTransaction(transaction({ timestamp: 10, ...exception, unitId: 99 }))
    context.writeRaw.mockImplementation(async () => {
      context.logTransaction(transaction({ timestamp: 5000, code: 6, ...exception }))
      return { written: true, error: exception.errorMessage } as never
    })
    const client = await connectInMemory(context)

    const result = await client.callTool({ name: 'client_write', arguments: args })

    expect(result.isError).toBe(true)
    expect(jsonOf(result).failedTransactions).toEqual([
      expect.objectContaining({ timestamp: 5000, code: 6, exceptionCode: 11 })
    ])
  })

  it('adds nothing to a successful write', async () => {
    const context = writable()
    context.logTransaction(transaction({ timestamp: 1, ...exception }))
    const client = await connectInMemory(context)

    const result = await client.callTool({ name: 'client_write', arguments: args })

    expect(result.isError).toBeUndefined()
    expect(jsonOf(result)).not.toHaveProperty('failedTransactions')
  })
})

describe('the scan tools', () => {
  it('attach no transactions to a scan that found nothing', async () => {
    const context = connected()
    context.scanUnitIds.mockImplementation(async () => {
      context.logTransaction(
        transaction({ timestamp: 5000, timeout: true, errorMessage: 'Timed out' })
      )
      return { scanned: true, stopped: false, results: [] }
    })
    const client = await connectInMemory(context)

    const result = await client.callTool({
      name: 'client_scan_unit_ids',
      arguments: { startUnitId: 1, endUnitId: 1 }
    })

    expect(JSON.stringify(jsonOf(result))).not.toContain('Timed out')
    expect(jsonOf(result)).not.toHaveProperty('failedTransactions')
  })
})
