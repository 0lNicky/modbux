import { describe, expect, it } from 'vitest'
import { SERVER_REQUEST_LOG_LIMIT, ServerRequest, ServerRequestLog } from '../requestLog'

const request = (overrides: Partial<ServerRequest>): ServerRequest => ({
  timestamp: 1000,
  uuid: 'a',
  unitId: 1,
  direction: 'read',
  registerType: 'holding_registers',
  address: 0,
  count: 1,
  outcome: 'ok',
  ...overrides
})

describe('ServerRequestLog', () => {
  it('keeps each server apart', () => {
    const log = new ServerRequestLog()
    log.record(request({ uuid: 'a', address: 1 }))
    log.record(request({ uuid: 'b', address: 2 }))

    expect(log.list('a', { limit: 50 }).map(({ address }) => address)).toEqual([1])
    expect(log.list('b', { limit: 50 }).map(({ address }) => address)).toEqual([2])
  })

  it('drops the oldest past the limit', () => {
    const log = new ServerRequestLog()
    for (let address = 0; address <= SERVER_REQUEST_LOG_LIMIT; address++) {
      log.record(request({ address }))
    }

    const kept = log.list('a', { limit: SERVER_REQUEST_LOG_LIMIT + 1 })
    expect(kept).toHaveLength(SERVER_REQUEST_LOG_LIMIT)
    expect(kept[0]?.address).toBe(1)
    expect(kept.at(-1)?.address).toBe(SERVER_REQUEST_LOG_LIMIT)
  })

  it('answers the newest `limit`, oldest first', () => {
    const log = new ServerRequestLog()
    for (const address of [1, 2, 3]) log.record(request({ address }))

    expect(log.list('a', { limit: 2 }).map(({ address }) => address)).toEqual([2, 3])
  })

  it('answers the requests at or after `sinceTimestamp`', () => {
    const log = new ServerRequestLog()
    for (const timestamp of [100, 200, 300]) log.record(request({ timestamp }))

    expect(
      log.list('a', { limit: 50, sinceTimestamp: 200 }).map(({ timestamp }) => timestamp)
    ).toEqual([200, 300])
  })

  it('answers the exceptions and the silences for `failedOnly`', () => {
    const log = new ServerRequestLog()
    log.record(request({ address: 1, outcome: 'ok' }))
    log.record(request({ address: 2, outcome: 'exception', exceptionCode: 2 }))
    log.record(request({ address: 3, outcome: 'no_response' }))

    expect(log.list('a', { limit: 50, failedOnly: true }).map(({ address }) => address)).toEqual([
      2, 3
    ])
  })

  it('applies `limit` after the other filters', () => {
    const log = new ServerRequestLog()
    log.record(request({ address: 1, outcome: 'no_response' }))
    log.record(request({ address: 2, outcome: 'ok' }))
    log.record(request({ address: 3, outcome: 'ok' }))

    expect(log.list('a', { limit: 1, failedOnly: true }).map(({ address }) => address)).toEqual([1])
  })

  it('forgets a deleted server', () => {
    const log = new ServerRequestLog()
    log.record(request({ uuid: 'a' }))
    log.record(request({ uuid: 'b' }))

    log.delete('a')

    expect(log.list('a', { limit: 50 })).toEqual([])
    expect(log.list('b', { limit: 50 })).toHaveLength(1)
  })
})
