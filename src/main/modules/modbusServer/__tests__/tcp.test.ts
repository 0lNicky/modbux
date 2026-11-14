/* eslint-disable @typescript-eslint/explicit-function-return-type */
//
// A real `ServerTCP` on a real socket, which `modbusServer.test.ts` mocks away.
// What these measure is modbus-serial's own: that it keeps the open sockets
// where `dropConnections` reads them, and that a reply sent from a timer
// reaches the wire.
import net from 'net'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Windows } from '../../../windows'
import { ServerFaults } from '../faults'
import { ServerRegistry } from '../registry'
import { ServerRequestLog } from '../requestLog'
import { TcpServers } from '../tcp'

const uuid = 'server-under-test'

let tcp: TcpServers
let registry: ServerRegistry
let faults: ServerFaults
let port: number
const sockets: net.Socket[] = []

/** A port nothing listens on, from the kernel. */
const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const probe = net.createServer()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address()
      probe.close(() =>
        typeof address === 'object' && address
          ? resolve(address.port)
          : reject(new Error('no port'))
      )
    })
  })

const connect = () =>
  new Promise<net.Socket>((resolve, reject) => {
    const socket = net.connect(port, '127.0.0.1', () => resolve(socket))
    socket.once('error', reject)
    sockets.push(socket)
  })

/** An FC3 read of `count` words of unit 1 from address 0, framed for TCP. */
const fc3 = (transactionId: number, count: number) =>
  Buffer.from([transactionId >> 8, transactionId & 0xff, 0, 0, 0, 6, 1, 3, 0, 0, 0, count])

/** Sends `request` and answers the first reply, and when it came. */
const ask = (socket: net.Socket, request: Buffer) =>
  new Promise<{ reply: Buffer; at: number }>((resolve) => {
    socket.once('data', (reply) => resolve({ reply, at: Date.now() }))
    socket.write(request)
  })

const closed = (socket: net.Socket) =>
  new Promise<void>((resolve) => {
    if (socket.closed) resolve()
    else socket.once('close', () => resolve())
  })

beforeEach(async () => {
  const windows = { send: vi.fn() } as unknown as Windows
  registry = new ServerRegistry({ windows, onUnitData: () => undefined })
  faults = new ServerFaults({ onChange: () => undefined })
  tcp = new TcpServers({ windows, registry, requestLog: new ServerRequestLog(), faults })
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
  port = await freePort()
  expect(await tcp.create({ uuid, port })).toBe(port)
})

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.destroy()
  await tcp.stopAll()
})

describe('dropConnections', () => {
  it('closes every open connection, and the listener takes the next one', async () => {
    const first = await connect()
    const second = await connect()
    // A reply on each says the server has accepted it, which is when it files it.
    await ask(first, fc3(1, 1))
    await ask(second, fc3(2, 1))

    expect(tcp.dropConnections(uuid)).toBe(2)
    await Promise.all([closed(first), closed(second)])

    const third = await connect()
    const { reply } = await ask(third, fc3(3, 1))
    expect(reply.readUInt16BE(9)).toBe(4242)
  })

  it('answers 0 for a listener nobody is connected to', () => {
    expect(tcp.dropConnections(uuid)).toBe(0)
  })

  it('answers nothing for a uuid with no listener', () => {
    expect(tcp.dropConnections('not-a-server')).toBeUndefined()
  })
})

describe('a delay rule on a real socket', () => {
  it('sends the reply once the delay has run out', async () => {
    faults.set(uuid, [{ action: { kind: 'delay', ms: 300 } }])
    const socket = await connect()

    const sentAt = Date.now()
    const { reply, at } = await ask(socket, fc3(7, 2))

    expect(at - sentAt).toBeGreaterThanOrEqual(290)
    expect(reply.readUInt16BE(0)).toBe(7)
    expect(reply.readUInt16BE(9)).toBe(4242)
  })
})
