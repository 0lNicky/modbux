/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { createRequire } from 'module'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IServiceVector } from 'modbus-serial'
import type { UnitIdString } from '@shared'
import type { Windows } from '../../../windows'
import { ServerRegistry } from '../registry'
import { ServerRequestLog } from '../requestLog'
import {
  createVector,
  GATEWAY_TARGET_FAILED,
  ILLEGAL_DATA_ADDRESS,
  SERVER_DEVICE_FAILURE,
  ServerTransport
} from '../vector'

/**
 * The vector driven through modbus-serial's own request handler, which is what
 * turns its answers into frames. TCP and RTU share that handler, so a reply
 * here is the PDU a master receives on either transport.
 */
type HandlerCallback = (err: { modbusErrorCode?: number } | null, response?: Buffer) => void
type Handler = (
  request: Buffer,
  vector: IServiceVector,
  unitId: number,
  callback: HandlerCallback
) => void
type BitHandler = (
  request: Buffer,
  vector: IServiceVector,
  unitId: number,
  callback: HandlerCallback,
  functionCode: number
) => void

const require = createRequire(import.meta.url)
require('modbus-serial/utils/buffer_bit')()
const handlers = require('modbus-serial/servers/servertcp_handler.js') as {
  readCoilsOrInputDiscretes: BitHandler
  readMultipleRegisters: Handler
  readInputRegisters: Handler
  writeCoil: Handler
  writeSingleRegister: Handler
  forceMultipleCoils: Handler
  writeMultipleRegisters: Handler
}

const uuid = 'server-under-test'

/** What the handler sent back: data, an exception, or nothing at all. */
type Reply = { data: Buffer } | { exception: number } | 'silence'

/**
 * A request frame as the handler reads it: unit id, function code, the PDU,
 * and two bytes where the CRC sits, which the transport has already checked.
 */
const frame = (unitId: number, functionCode: number, pdu: number[]): Buffer =>
  Buffer.from([unitId, functionCode, ...pdu, 0, 0])

const word = (value: number): number[] => [value >> 8, value & 0xff]

/** Waits for the microtask a bit request is answered from. */
const answered = (): Promise<void> => Promise.resolve()

let windows: Windows & { send: ReturnType<typeof vi.fn> }
let registry: ServerRegistry
let requestLog: ServerRequestLog

const vectorOn = (transport: ServerTransport) => createVector(registry, requestLog, uuid, transport)

/** Runs `handle`, which sends one frame through a handler, and answers what came back. */
const send = async (handle: (callback: HandlerCallback) => void): Promise<Reply> => {
  let reply: Reply = 'silence'
  let replies = 0
  handle((err, response) => {
    replies++
    if (replies > 1) return
    if (err) reply = { exception: err.modbusErrorCode ?? SERVER_DEVICE_FAILURE }
    else if (response) reply = { data: response }
  })
  await answered()
  return reply
}

const readHolding = (vector: IServiceVector, unitId: number, address: number, count: number) =>
  send((callback) =>
    handlers.readMultipleRegisters(
      frame(unitId, 3, [...word(address), ...word(count)]),
      vector,
      unitId,
      callback
    )
  )

const readInput = (vector: IServiceVector, unitId: number, address: number, count: number) =>
  send((callback) =>
    handlers.readInputRegisters(
      frame(unitId, 4, [...word(address), ...word(count)]),
      vector,
      unitId,
      callback
    )
  )

const readCoils = (vector: IServiceVector, unitId: number, address: number, count: number) =>
  send((callback) =>
    handlers.readCoilsOrInputDiscretes(
      frame(unitId, 1, [...word(address), ...word(count)]),
      vector,
      unitId,
      callback,
      1
    )
  )

const writeRegisters = (
  vector: IServiceVector,
  unitId: number,
  address: number,
  values: number[]
) =>
  send((callback) =>
    handlers.writeMultipleRegisters(
      frame(unitId, 16, [
        ...word(address),
        ...word(values.length),
        values.length * 2,
        ...values.flatMap(word)
      ]),
      vector,
      unitId,
      callback
    )
  )

const writeCoils = (vector: IServiceVector, unitId: number, address: number, states: boolean[]) => {
  const bytes = Array.from({ length: Math.ceil(states.length / 8) }, (_, byte) =>
    states
      .slice(byte * 8, byte * 8 + 8)
      .reduce((packed, state, bit) => packed | (state ? 1 << bit : 0), 0)
  )
  return send((callback) =>
    handlers.forceMultipleCoils(
      frame(unitId, 15, [...word(address), ...word(states.length), bytes.length, ...bytes]),
      vector,
      unitId,
      callback
    )
  )
}

/** The words of a register read's reply. */
const wordsOf = (reply: Reply): number[] => {
  if (reply === 'silence' || !('data' in reply))
    throw new Error(`no data: ${JSON.stringify(reply)}`)
  const byteCount = reply.data.readUInt8(2)
  return Array.from({ length: byteCount / 2 }, (_, i) => reply.data.readUInt16BE(3 + i * 2))
}

/** The first `count` bits of a coil read's reply. */
const bitsOf = (reply: Reply, count: number): boolean[] => {
  if (reply === 'silence' || !('data' in reply))
    throw new Error(`no data: ${JSON.stringify(reply)}`)
  const data = reply.data
  return Array.from(
    { length: count },
    (_, i) => ((data.readUInt8(3 + (i >> 3)) >> (i % 8)) & 1) === 1
  )
}

const hostRegister = (unitId: UnitIdString, address: number, value: number) =>
  registry.addRegister({
    uuid,
    unitId,
    params: {
      address,
      registerType: 'holding_registers',
      dataType: 'uint16',
      comment: '',
      value,
      min: undefined,
      max: undefined,
      interval: undefined
    }
  })

const requests = () => requestLog.list(uuid, { limit: 100 })

const registerValueEvents = () =>
  windows.send.mock.calls.filter(([channel]) => channel === 'register_value')

beforeEach(() => {
  windows = { send: vi.fn() } as unknown as Windows & { send: ReturnType<typeof vi.fn> }
  registry = new ServerRegistry({ windows, onUnitData: () => undefined })
  requestLog = new ServerRequestLog()
})

describe('a read is one request', () => {
  it('records a multi-register read as one request', async () => {
    hostRegister('1', 10, 111)
    hostRegister('1', 12, 333)

    const reply = await readHolding(vectorOn('tcp'), 1, 10, 3)

    expect(wordsOf(reply)).toEqual([111, 0, 333])
    expect(requests()).toEqual([
      expect.objectContaining({
        uuid,
        unitId: 1,
        direction: 'read',
        registerType: 'holding_registers',
        address: 10,
        count: 3,
        outcome: 'ok'
      })
    ])
  })

  it('records a one-register read, which modbus-serial sends to the single accessor', async () => {
    hostRegister('1', 10, 111)

    const reply = await readInput(vectorOn('tcp'), 1, 10, 1)

    expect(wordsOf(reply)).toEqual([0])
    expect(requests()).toEqual([
      expect.objectContaining({ registerType: 'input_registers', address: 10, count: 1 })
    ])
  })

  it('records the per-bit calls of a coil read as one request', async () => {
    registry.setBool({ uuid, unitId: '1', registerType: 'coils', address: 21, state: true })
    registry.setBool({ uuid, unitId: '1', registerType: 'coils', address: 29, state: true })

    const reply = await readCoils(vectorOn('tcp'), 1, 20, 10)

    expect(bitsOf(reply, 10)).toEqual([
      false,
      true,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      true
    ])
    expect(requests()).toEqual([
      expect.objectContaining({
        direction: 'read',
        registerType: 'coils',
        address: 20,
        count: 10,
        outcome: 'ok'
      })
    ])
  })

  it('keeps two frames apart, because modbus-serial starts each from its own timer', async () => {
    registry.setBool({ uuid, unitId: '1', registerType: 'coils', address: 0, state: true })
    const vector = vectorOn('tcp')
    const replies: (Buffer | undefined)[] = []
    const receive: HandlerCallback = (_err, response) => void replies.push(response)

    setTimeout(() =>
      handlers.readCoilsOrInputDiscretes(frame(1, 1, [0, 0, 0, 4]), vector, 1, receive, 1)
    )
    setTimeout(() =>
      handlers.readCoilsOrInputDiscretes(frame(1, 1, [0, 4, 0, 4]), vector, 1, receive, 1)
    )
    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(replies).toHaveLength(2)
    expect(requests().map(({ address, count }) => [address, count])).toEqual([
      [0, 4],
      [4, 4]
    ])
  })

  it('answers a coil read running past the top of the range with exception 2', async () => {
    registry.setBool({ uuid, unitId: '1', registerType: 'coils', address: 0, state: true })

    const reply = await readCoils(vectorOn('tcp'), 1, 65530, 10)

    expect(reply).toEqual({ exception: ILLEGAL_DATA_ADDRESS })
    expect(requests()).toEqual([
      expect.objectContaining({ address: 65530, count: 10, outcome: 'exception', exceptionCode: 2 })
    ])
  })
})

describe('the three outcomes', () => {
  it('records an answered read as ok, with no exception code', async () => {
    hostRegister('1', 0, 7)

    await readHolding(vectorOn('tcp'), 1, 0, 2)

    const [request] = requests()
    expect(request?.outcome).toBe('ok')
    expect(request).not.toHaveProperty('exceptionCode')
  })

  // FC4's handler reads `values[i]` on its error path as well, so an error
  // handed over without an array came out as exception 4.
  it('answers a multi-register input read for a unit it does not host with exception 11', async () => {
    hostRegister('1', 0, 7)

    const reply = await readInput(vectorOn('tcp'), 5, 0, 4)

    expect(reply).toEqual({ exception: GATEWAY_TARGET_FAILED })
    expect(requests()).toEqual([
      expect.objectContaining({ unitId: 5, outcome: 'exception', exceptionCode: 11 })
    ])
  })

  it('answers a multi-register holding read past the top of the range with exception 2', async () => {
    hostRegister('1', 0, 7)

    const reply = await readHolding(vectorOn('tcp'), 1, 65534, 3)

    expect(reply).toEqual({ exception: ILLEGAL_DATA_ADDRESS })
  })

  it('records silence for a unit it does not host on RTU', async () => {
    hostRegister('1', 0, 7)

    const registers = await readHolding(vectorOn('rtu'), 5, 0, 4)
    const coils = await readCoils(vectorOn('rtu'), 5, 0, 4)

    expect([registers, coils]).toEqual(['silence', 'silence'])
    expect(requests().map(({ registerType, outcome }) => [registerType, outcome])).toEqual([
      ['holding_registers', 'no_response'],
      ['coils', 'no_response']
    ])
  })

  it('records silence for a read of unit 0 on RTU, which is the broadcast address', async () => {
    hostRegister('0', 0, 7)

    const reply = await readHolding(vectorOn('rtu'), 0, 0, 2)

    expect(reply).toBe('silence')
    expect(requests()).toEqual([expect.objectContaining({ unitId: 0, outcome: 'no_response' })])
  })
})

describe('a multi-write is all of its addresses or none', () => {
  // The handler answers a zero-length FC16 with exception 2 and then calls
  // `setRegisterArray` with an empty array all the same.
  it('answers a zero-length FC16 once, with exception 2, and records it so', async () => {
    hostRegister('1', 0, 0)
    const vector = vectorOn('tcp')
    const replies: (number | 'ok')[] = []

    handlers.writeMultipleRegisters(frame(1, 16, [0, 0, 0, 0, 0]), vector, 1, (err) =>
      replies.push(err ? (err.modbusErrorCode ?? SERVER_DEVICE_FAILURE) : 'ok')
    )
    await answered()

    expect(replies).toEqual([ILLEGAL_DATA_ADDRESS])
    expect(requests()).toEqual([
      expect.objectContaining({ count: 0, outcome: 'exception', exceptionCode: 2 })
    ])
  })

  // The handler refuses a zero-length FC1, FC3, FC4 or FC15 itself and calls
  // no accessor, so the vector neither answers nor records one.
  it.each([
    [
      'FC1',
      (callback: HandlerCallback) =>
        handlers.readCoilsOrInputDiscretes(
          frame(1, 1, [0, 0, 0, 0]),
          vectorOn('tcp'),
          1,
          callback,
          1
        )
    ],
    [
      'FC3',
      (callback: HandlerCallback) =>
        handlers.readMultipleRegisters(frame(1, 3, [0, 0, 0, 0]), vectorOn('tcp'), 1, callback)
    ],
    [
      'FC4',
      (callback: HandlerCallback) =>
        handlers.readInputRegisters(frame(1, 4, [0, 0, 0, 0]), vectorOn('tcp'), 1, callback)
    ],
    [
      'FC15',
      (callback: HandlerCallback) =>
        handlers.forceMultipleCoils(frame(1, 15, [0, 0, 0, 0, 0]), vectorOn('tcp'), 1, callback)
    ]
  ])("answers a zero-length %s once, with the handler's exception 2", async (_name, handle) => {
    hostRegister('1', 0, 0)
    const replies: (number | 'ok')[] = []

    handle((err) => replies.push(err ? (err.modbusErrorCode ?? SERVER_DEVICE_FAILURE) : 'ok'))
    await answered()

    expect(replies).toEqual([ILLEGAL_DATA_ADDRESS])
    expect(requests()).toEqual([])
  })

  it('writes every register of an FC16, tells the view of each, and records the values', async () => {
    hostRegister('1', 0, 0)
    windows.send.mockClear()

    const reply = await writeRegisters(vectorOn('tcp'), 1, 100, [1, 2, 3])

    expect(reply).not.toBe('silence')
    expect(reply).not.toHaveProperty('exception')
    expect([100, 101, 102].map((a) => registry.read(uuid, '1', 'holding_registers', a))).toEqual([
      1, 2, 3
    ])
    expect(registerValueEvents().map(([, event]) => [event.address, event.value])).toEqual([
      [100, 1],
      [101, 2],
      [102, 3]
    ])
    expect(requests()).toEqual([
      expect.objectContaining({
        direction: 'write',
        registerType: 'holding_registers',
        address: 100,
        count: 3,
        outcome: 'ok',
        values: [1, 2, 3]
      })
    ])
  })

  it('writes no register of an FC16 running past the top of the range', async () => {
    hostRegister('1', 0, 0)
    windows.send.mockClear()

    const reply = await writeRegisters(vectorOn('tcp'), 1, 65534, [1, 2, 3])

    expect(reply).toEqual({ exception: ILLEGAL_DATA_ADDRESS })
    expect(registry.read(uuid, '1', 'holding_registers', 65534)).toBeUndefined()
    expect(registry.read(uuid, '1', 'holding_registers', 65535)).toBeUndefined()
    expect(registerValueEvents()).toEqual([])
    expect(requests()).toEqual([
      expect.objectContaining({ outcome: 'exception', exceptionCode: 2, values: [1, 2, 3] })
    ])
  })

  it('writes every coil of an FC15 and records the states', async () => {
    hostRegister('1', 0, 0)

    const reply = await writeCoils(vectorOn('tcp'), 1, 8, [true, false, true])

    expect(reply).not.toBe('silence')
    expect(reply).not.toHaveProperty('exception')
    expect([8, 9, 10].map((a) => registry.read(uuid, '1', 'coils', a))).toEqual([true, false, true])
    expect(requests()).toEqual([
      expect.objectContaining({
        direction: 'write',
        registerType: 'coils',
        address: 8,
        count: 3,
        outcome: 'ok',
        values: [true, false, true]
      })
    ])
  })

  it('writes no coil of an FC15 running past the top of the range', async () => {
    hostRegister('1', 0, 0)
    windows.send.mockClear()

    const reply = await writeCoils(vectorOn('tcp'), 1, 65534, [true, true, true])

    expect(reply).toEqual({ exception: ILLEGAL_DATA_ADDRESS })
    expect(registry.read(uuid, '1', 'coils', 65534)).toBeUndefined()
    expect(registerValueEvents()).toEqual([])
  })

  it('answers an FC15 for a unit it does not host with exception 11 over TCP', async () => {
    hostRegister('1', 0, 0)

    const reply = await writeCoils(vectorOn('tcp'), 5, 0, [true, true])

    expect(reply).toEqual({ exception: GATEWAY_TARGET_FAILED })
    expect(registry.hostsUnit(uuid, '5')).toBe(false)
  })

  it('says nothing to an FC15 for a unit it does not host over RTU, and creates nothing', async () => {
    hostRegister('1', 0, 0)

    const reply = await writeCoils(vectorOn('rtu'), 5, 0, [true, true])

    expect(reply).toBe('silence')
    expect(registry.hostsUnit(uuid, '5')).toBe(false)
    expect(requests()).toEqual([expect.objectContaining({ unitId: 5, outcome: 'no_response' })])
  })
})

describe('an RTU broadcast write', () => {
  it('writes no unit for an FC16 running past the top of the range, and records no response', async () => {
    hostRegister('1', 0, 0)
    windows.send.mockClear()

    const reply = await writeRegisters(vectorOn('rtu'), 0, 65535, [41, 42])

    expect(reply).toBe('silence')
    expect(registry.read(uuid, '1', 'holding_registers', 65535)).toBeUndefined()
    expect(registry.read(uuid, '1', 'holding_registers', 65536)).toBeUndefined()
    expect(registerValueEvents()).toEqual([])
    expect(requests()).toEqual([
      expect.objectContaining({ unitId: 0, direction: 'write', outcome: 'no_response' })
    ])
  })

  it('writes no unit for an FC15 running past the top of the range', async () => {
    hostRegister('1', 0, 0)
    windows.send.mockClear()

    const reply = await writeCoils(vectorOn('rtu'), 0, 65534, [true, true, true])

    expect(reply).toBe('silence')
    expect(registry.read(uuid, '1', 'coils', 65534)).toBeUndefined()
    expect(registerValueEvents()).toEqual([])
    expect(requests()).toEqual([expect.objectContaining({ unitId: 0, outcome: 'no_response' })])
  })

  it('writes an FC16 to every unit it hosts, answers nothing, and records it ok', async () => {
    hostRegister('1', 0, 0)
    hostRegister('2', 0, 0)

    const reply = await writeRegisters(vectorOn('rtu'), 0, 9, [41, 42])

    expect(reply).toBe('silence')
    for (const unitId of ['1', '2'] as const) {
      expect([9, 10].map((a) => registry.read(uuid, unitId, 'holding_registers', a))).toEqual([
        41, 42
      ])
    }
    expect(requests()).toEqual([
      expect.objectContaining({ unitId: 0, direction: 'write', outcome: 'ok', values: [41, 42] })
    ])
  })

  it('writes an FC15 to every unit it hosts and answers nothing', async () => {
    hostRegister('1', 0, 0)
    hostRegister('2', 0, 0)

    const reply = await writeCoils(vectorOn('rtu'), 0, 3, [true, true])

    expect(reply).toBe('silence')
    expect(registry.read(uuid, '1', 'coils', 4)).toBe(true)
    expect(registry.read(uuid, '2', 'coils', 4)).toBe(true)
  })
})

describe('a collected answer', () => {
  it('starts a request of its own at an address that does not follow the last', async () => {
    registry.setBool({ uuid, unitId: '1', registerType: 'coils', address: 0, state: true })
    const { getCoil } = vectorOn('tcp')
    if (!getCoil) throw new Error('the vector has no getCoil')

    getCoil(0, 1, vi.fn())
    getCoil(1, 1, vi.fn())
    getCoil(7, 1, vi.fn())
    await answered()

    expect(requests().map(({ address, count }) => [address, count])).toEqual([
      [0, 2],
      [7, 1]
    ])
  })

  it('starts a request of its own for another unit', async () => {
    registry.setBool({ uuid, unitId: '1', registerType: 'coils', address: 0, state: true })
    registry.setBool({ uuid, unitId: '2', registerType: 'coils', address: 0, state: true })
    const { getCoil } = vectorOn('tcp')
    if (!getCoil) throw new Error('the vector has no getCoil')

    getCoil(0, 1, vi.fn())
    getCoil(1, 2, vi.fn())
    await answered()

    expect(requests().map(({ unitId, address, count }) => [unitId, address, count])).toEqual([
      [1, 0, 1],
      [2, 1, 1]
    ])
  })

  it('answers exception 4 to a callback that throws, as the handler does', async () => {
    registry.setBool({ uuid, unitId: '1', registerType: 'coils', address: 0, state: true })
    const vector = vectorOn('tcp')
    const cb = vi.fn((err: Error | null) => {
      if (!err) throw new Error('the frame could not be written')
    })

    const { getCoil } = vector
    if (!getCoil) throw new Error('the vector has no getCoil')
    getCoil(0, 1, cb)
    await answered()

    expect(cb).toHaveBeenNthCalledWith(1, null, true)
    expect(cb).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ modbusErrorCode: SERVER_DEVICE_FAILURE }),
      false
    )
  })
})
