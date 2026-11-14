import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MAX_TRANSACTIONS, type RawTransaction } from '@shared'
import type ModbusRTU from 'modbus-serial'
import type { Windows } from '../../../windows'
import { exceptionCodeOf, TransactionLog } from '../transactionLog'

// Captured by the e2e run (spec 40): a read of unit 99 answered with exception 11.
// Over ModbusTcp the logged frames carry a CRC and no MBAP header.
const TCP_CAPTURED_EXCEPTION = '63 83 0B A1 29'
const RTU_EXCEPTION = '07 83 0B 00 00'
const OK = '07 03 02 00 64 00 00'

describe('exceptionCodeOf', () => {
  it('reads the code of a frame captured over ModbusTcp', () => {
    expect(exceptionCodeOf([TCP_CAPTURED_EXCEPTION])).toBe(11)
  })

  it('reads the code of an RTU frame', () => {
    expect(exceptionCodeOf([RTU_EXCEPTION])).toBe(11)
  })

  it('answers undefined for a normal response', () => {
    expect(exceptionCodeOf([OK])).toBeUndefined()
  })

  it('answers undefined for no response, and for a frame cut before the code', () => {
    expect(exceptionCodeOf([])).toBeUndefined()
    expect(exceptionCodeOf(['07 83'])).toBeUndefined()
  })

  it('finds the exception in any of several responses', () => {
    expect(exceptionCodeOf([OK, RTU_EXCEPTION])).toBe(11)
  })
})

describe('TransactionLog', () => {
  let table: Record<string, RawTransaction | undefined>
  let nextKey: number
  let send: ReturnType<typeof vi.fn>
  let log: TransactionLog

  const raw = (overrides: Partial<RawTransaction> = {}): RawTransaction => ({
    nextAddress: 7,
    nextCode: 3,
    nextLength: 1,
    _timeoutFired: false,
    request: Buffer.from([7, 3, 0, 0, 0, 1]),
    responses: [Buffer.from(OK.replace(/ /g, ''), 'hex')],
    ...overrides
  })

  /** File a request under the next key and log it, the way a read does. */
  const logOne = (overrides: Partial<RawTransaction> = {}, errorMessage?: string): void => {
    const key = log.nextTransactionIdKey()
    table[key] = raw(overrides)
    nextKey += 1
    log.log(key, errorMessage)
  }

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000_000)
    table = {}
    nextKey = 1
    send = vi.fn()
    const client = {
      get _transactions(): typeof table {
        return table
      },
      get _port(): { _transactionIdWrite: number } {
        return { _transactionIdWrite: nextKey }
      }
    }
    log = new TransactionLog({
      client: (): ModbusRTU => client as unknown as ModbusRTU,
      windows: { send } as unknown as Windows
    })
  })

  afterEach(() => vi.useRealTimers())

  it('keeps what it sends to the window, oldest first', () => {
    logOne()
    vi.setSystemTime(1_000_010)
    logOne({ nextAddress: 8 })

    expect(log.list().map((transaction) => transaction.unitId)).toEqual([7, 8])
    expect(send).toHaveBeenCalledTimes(2)
    expect(send.mock.calls[1]?.[1]).toBe(log.list()[1])
  })

  it('sends the window a transaction without exceptionCode, and keeps it in main', () => {
    logOne({ responses: [Buffer.from(RTU_EXCEPTION.replace(/ /g, ''), 'hex')] }, 'Illegal')

    expect(send.mock.calls[0]?.[1]).not.toHaveProperty('exceptionCode')
    expect(log.list()[0]?.exceptionCode).toBe(11)
  })

  it('keeps the newest MAX_TRANSACTIONS and drops the oldest', () => {
    for (let unit = 0; unit < MAX_TRANSACTIONS + 5; unit += 1) logOne({ nextAddress: unit })

    const kept = log.list()
    expect(kept).toHaveLength(MAX_TRANSACTIONS)
    expect(kept[0]?.unitId).toBe(5)
    expect(kept.at(-1)?.unitId).toBe(MAX_TRANSACTIONS + 4)
  })

  it('measures the time from the key being handed out to the log', () => {
    const key = log.nextTransactionIdKey()
    table[key] = raw()
    vi.advanceTimersByTime(250)
    log.log(key, undefined)

    expect(log.list()[0]?.durationMs).toBe(250)
  })

  it('leaves durationMs undefined for a request it never saw go out', () => {
    table['1'] = raw()
    log.log('1', undefined)

    expect(log.list()[0]?.durationMs).toBeUndefined()
  })

  it('logs a timeout with the time it waited', () => {
    const key = log.nextTransactionIdKey()
    table[key] = raw({ _timeoutFired: true, responses: [] })
    vi.advanceTimersByTime(3000)
    log.log(key, 'Timed out')

    expect(log.list()[0]).toMatchObject({ timeout: true, durationMs: 3000 })
  })

  describe('list', () => {
    beforeEach(() => {
      logOne() // t 1_000_000, fine
      vi.setSystemTime(1_000_100)
      logOne({ responses: [Buffer.from(RTU_EXCEPTION.replace(/ /g, ''), 'hex')] }, 'Illegal')
      vi.setSystemTime(1_000_200)
      logOne({ _timeoutFired: true, responses: [] }, 'Timed out')
      vi.setSystemTime(1_000_300)
      logOne()
    })

    it('limit keeps the newest, still oldest first', () => {
      expect(log.list({ limit: 2 }).map((transaction) => transaction.timestamp)).toEqual([
        1_000_200, 1_000_300
      ])
    })

    it('sinceTimestamp includes the timestamp itself', () => {
      expect(log.list({ sinceTimestamp: 1_000_200 })).toHaveLength(2)
      expect(log.list({ sinceTimestamp: 1_000_201 })).toHaveLength(1)
    })

    it('failedOnly keeps the exception and the timeout, not the successes', () => {
      expect(log.list({ failedOnly: true }).map((transaction) => transaction.timestamp)).toEqual([
        1_000_100, 1_000_200
      ])
    })

    it('failedOnly keeps an exception whose error message is missing', () => {
      logOne({ responses: [Buffer.from(RTU_EXCEPTION.replace(/ /g, ''), 'hex')] })

      expect(log.list({ failedOnly: true })).toHaveLength(3)
    })

    it('afterMark keeps what was logged after the mark, and survives the cap', () => {
      const mark = log.mark()
      logOne({ nextAddress: 21 }, 'late')

      expect(log.list({ afterMark: mark }).map((transaction) => transaction.unitId)).toEqual([21])

      for (let unit = 0; unit < MAX_TRANSACTIONS; unit += 1) logOne({ nextAddress: 22 })
      // The cap has dropped the entries before the mark and the one after it.
      expect(log.list({ afterMark: mark })).toHaveLength(MAX_TRANSACTIONS)
      expect(log.list({ afterMark: mark }).every((transaction) => transaction.unitId !== 7)).toBe(
        true
      )
    })

    it('combines limit with failedOnly: the newest failures', () => {
      expect(log.list({ failedOnly: true, limit: 1 })[0]?.timestamp).toBe(1_000_200)
    })
  })
})
