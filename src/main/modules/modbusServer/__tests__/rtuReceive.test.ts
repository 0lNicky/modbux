import { createRequire } from 'module'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ServerSerial } from 'modbus-serial'
import { MockBinding } from '@serialport/binding-mock'
import type { Windows } from '../../../windows'
import { ServerFaults } from '../faults'
import { ServerRegistry } from '../registry'
import { ServerRequestLog } from '../requestLog'
import { createVector, PendingReplies } from '../vector'

/**
 * A frame through `ServerSerial`'s own data listener, on an in-memory port, so
 * what the library does before `_parseModbusBuffer` is part of the test.
 */
const require = createRequire(import.meta.url)
require('modbus-serial/utils/buffer_bit')()

const uuid = 'rtu-under-test'
const PORT_PATH = '/dev/modbux-mock'

/** The slice of `SerialPortStream` this file reads: the binding's port. */
interface MockedPort {
  port: { emitData: (data: Buffer) => void; lastWrite: Buffer | null }
  close: () => void
}

/** Unit 1, FC3, address 0, quantity 1, and a CRC that is not the frame's. */
const WRONG_CRC_READ = Buffer.from([0x01, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00])

type ServerSerialWithPort = ServerSerial & { getPort: () => MockedPort }
type ServerSerialConstructor = new (
  ...args: [...ConstructorParameters<typeof ServerSerial>, Record<string, unknown>]
) => ServerSerialWithPort

let server: ServerSerialWithPort
let requestLog: ServerRequestLog
let faults: ServerFaults

beforeEach(async () => {
  MockBinding.reset()
  MockBinding.createPort(PORT_PATH, { echo: false, record: true })
  const windows = { send: vi.fn() } as unknown as Windows
  const registry = new ServerRegistry({ windows, onUnitData: (): void => undefined })
  registry.addRegister({
    uuid,
    unitId: '1',
    params: {
      address: 0,
      registerType: 'holding_registers',
      dataType: 'uint16',
      comment: '',
      value: 4242,
      min: undefined,
      max: undefined,
      interval: undefined
    }
  })
  requestLog = new ServerRequestLog()
  faults = new ServerFaults({ onChange: (): void => undefined })

  server = new (ServerSerial as unknown as ServerSerialConstructor)(
    createVector({ registry, requestLog, faults }, uuid, 'rtu', new PendingReplies()),
    { path: PORT_PATH, baudRate: 9600, binding: MockBinding },
    {}
  )
  await new Promise<void>((resolve) => server.once('initialized', () => resolve()))
})

afterEach(() => {
  server.getPort().close()
})

describe('an RTU frame with a wrong CRC', () => {
  // `serverserial.js` recomputes the CRC in its data listener and writes it
  // over the received one, so `_parseModbusBuffer`'s CRC check never sees a
  // wrong CRC and the frame reaches the vector.
  it('reaches the vector, is answered and is recorded', async () => {
    server.getPort().port.emitData(WRONG_CRC_READ)

    await vi.waitFor(() => expect(requestLog.list(uuid, { limit: 10 })).toHaveLength(1))
    expect(requestLog.list(uuid, { limit: 10 })).toEqual([
      expect.objectContaining({
        unitId: 1,
        direction: 'read',
        registerType: 'holding_registers',
        address: 0,
        count: 1,
        outcome: 'ok'
      })
    ])
    expect(server.getPort().port.lastWrite?.subarray(0, 5)).toEqual(
      Buffer.from([0x01, 0x03, 0x02, 0x10, 0x92])
    )
  })

  it('meets a fault rule like any other request', async () => {
    faults.set(uuid, [{ action: { kind: 'exception', code: 6 } }])

    server.getPort().port.emitData(WRONG_CRC_READ)

    await vi.waitFor(() => expect(requestLog.list(uuid, { limit: 10 })).toHaveLength(1))
    expect(requestLog.list(uuid, { limit: 10 })).toEqual([
      expect.objectContaining({
        outcome: 'exception',
        exceptionCode: 6,
        fault: { rule: 0 }
      })
    ])
  })
})
