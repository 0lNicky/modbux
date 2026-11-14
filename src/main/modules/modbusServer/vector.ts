import {
  MAX_REGISTER_ADDRESS,
  RegisterType,
  ServerDataValue,
  UnitIdString,
  UnitIdStringSchema
} from '@shared'
import type { FCallback, FCallbackVal, IServiceVector } from 'modbus-serial'
import { ServerFaults } from './faults'
import { ServerRegistry } from './registry'
import { ServerRequestFault, ServerRequestLog } from './requestLog'

/**
 * The three Modbus exception codes this server sends.
 *
 * The other seven of the protocol's table are not here: an exported constant
 * nothing names costs a lint disable, which is a worse comment than none.
 * `modbusServer.test.ts` asserts on all three of these.
 */
export const ILLEGAL_DATA_ADDRESS = 2
export const SERVER_DEVICE_FAILURE = 4
export const GATEWAY_TARGET_FAILED = 11

/**
 * The transport a vector answers on. RS-485 is shared and a socket is not, so a
 * request for a unit id this server does not host cannot get the same answer on
 * both.
 */
export type ServerTransport = 'tcp' | 'rtu'

/** Unit 0 is the broadcast address on RTU. */
export const BROADCAST_UNIT_ID: UnitIdString = '0'

/**
 * The accessor shapes `createVector` fills.
 *
 * These are written out rather than derived from `IServiceVector`, so what
 * checks them is the assignment in `createVector`. That catches a signature
 * modbus-serial changes incompatibly and not one it widens, because a version
 * that adds an optional parameter stays assignable to these.
 */
type IServiceVectorGet<T> = (addr: number, unitID: number, cb: FCallbackVal<T>) => void
type IServiceVectorGetMultiple = (
  addr: number,
  length: number,
  unitID: number,
  cb: FCallbackVal<number[]>
) => void
type IServiceVectorSet<T> = (addr: number, value: T, unitID: number, cb: FCallback) => void

/** What every vector reads and writes: the registers, the request log and the fault rules. */
export interface VectorStores {
  registry: ServerRegistry
  requestLog: ServerRequestLog
  faults: ServerFaults
}

/** What the vector is bound to: one uuid of the stores, on one transport. */
interface VectorScope extends VectorStores {
  uuid: string
  transport: ServerTransport
}

/** One request, whole, as modbus-serial handed it over in one or more calls. */
interface ServerRequestInput<K extends RegisterType> {
  unitId: number
  registerType: K
  address: number
  count: number
  /** What a write carries, one per address. A read has none. */
  values?: ServerDataValue<K>[]
}

/**
 * A request the vector accepted.
 *
 * `reply` is false for an RTU broadcast write, which is written and never
 * answered. `read` answers the value at an offset from the first address, and
 * a write's is never asked.
 */
interface ServerAnswerOk<K extends RegisterType> {
  outcome: 'ok'
  reply: boolean
  read: (offset: number) => ServerDataValue<K>
}

/**
 * A request the vector refused with an exception code. `reply` is false where
 * the handler has already sent that exception itself.
 */
interface ServerAnswerException {
  outcome: 'exception'
  code: number
  reply: boolean
}

/** What the vector answers a request. */
type ServerAnswer<K extends RegisterType> =
  | ServerAnswerOk<K>
  | ServerAnswerException
  | { outcome: 'no_response' }

/** An answer, and how long a delay rule holds it back. */
interface ServedRequest<K extends RegisterType> {
  answer: ServerAnswer<K>
  delayMs?: number
}

/** A Modbus error as modbus-serial reads one: an `Error` carrying the code. */
const modbusError = (code: number): Error => Object.assign(new Error(), { modbusErrorCode: code })

/**
 * Unit 0 is broadcast on RTU. On TCP there is no broadcast at all and the
 * unit identifier routes through a gateway, so 0 is an address like any other.
 */
const isBroadcast = (transport: ServerTransport, unitId: UnitIdString): boolean =>
  transport === 'rtu' && unitId === BROADCAST_UNIT_ID

/**
 * Answers a request for a unit id this server does not host.
 *
 * modbus-serial writes a frame when the vector calls `cb` and writes nothing
 * when it does not, so an answer that calls no `cb` is silence on the wire.
 * On RS-485 silence is the only safe answer: the id belongs to a real device
 * answering at that moment, and a second frame collides with it. A socket
 * carries one device, so silence there is a client timeout instead, and the
 * gateway code says what happened.
 */
const refuseUnit = <K extends RegisterType>(transport: ServerTransport): ServerAnswer<K> =>
  transport === 'rtu'
    ? { outcome: 'no_response' }
    : { outcome: 'exception', code: GATEWAY_TARGET_FAILED, reply: true }

/**
 * Decides a whole request, reads or writes it, and records it.
 *
 * Every check runs before the first address is read or written, so a write is
 * all of its addresses or none of them, and the answer is one decision about
 * the request rather than one per address.
 *
 * A fault rule is one of those checks. It is asked once the request is known
 * to be one the handler has not answered itself, and before anything the
 * server would answer on its own, so a rule for a unit this server does not
 * host or for an address past the top still decides. `exception` and
 * `no_response` return before the first write; `delay` lets the request run as
 * usual and holds back the answer, which `reply` sends late.
 */
const serve = <K extends RegisterType>(
  { registry, requestLog, faults, uuid, transport }: VectorScope,
  request: ServerRequestInput<K>,
  fallback: ServerDataValue<K>
): ServedRequest<K> => {
  let fault: ServerRequestFault | undefined
  let delayMs: number | undefined

  const decide = (): ServerAnswer<K> => {
    const unitIdSafe = UnitIdStringSchema.safeParse(String(request.unitId))
    if (!unitIdSafe.success) {
      return { outcome: 'exception', code: SERVER_DEVICE_FAILURE, reply: true }
    }
    const unitId = unitIdSafe.data
    const { registerType, address, count, values } = request

    // The handler answers a zero-length FC16 with exception 2 and calls
    // `setRegisterArray` with an empty array afterwards, and any `cb` called
    // then sends a second frame. The vector records that exception and adds
    // nothing.
    if (count === 0) return { outcome: 'exception', code: ILLEGAL_DATA_ADDRESS, reply: false }

    const broadcast = isBroadcast(transport, unitId)
    const applied = faults.decide(uuid, {
      unitId: request.unitId,
      registerType,
      address,
      count,
      direction: values ? 'write' : 'read'
    })
    if (applied) {
      const { rule, action } = applied
      fault = { rule }
      // A broadcast is never answered, so an exception rule leaves it silent
      // and a delay rule has nothing to hold back.
      if (action.kind === 'no_response') return { outcome: 'no_response' }
      if (action.kind === 'exception') {
        return broadcast
          ? { outcome: 'no_response' }
          : { outcome: 'exception', code: action.code, reply: true }
      }
      if (!broadcast) {
        delayMs = action.ms
        fault = { rule, delayMs }
      }
    }

    // A request running past the top of the range asks for addresses the
    // protocol cannot express, and neither a map nor `registry.write` refuses
    // one, so the range is asked before any address is read or written.
    const inRange = address + count - 1 <= MAX_REGISTER_ADDRESS

    // A broadcast write reaches every unit on the bus and is never answered,
    // and a broadcast read has nothing to answer with. One out of range is
    // written nowhere, and the silence stays.
    if (broadcast) {
      if (!values || !inRange) return { outcome: 'no_response' }
      for (const hostedUnitId of registry.hostedUnitIds(uuid))
        for (const [offset, value] of values.entries())
          registry.write(registerType, uuid, hostedUnitId, address + offset, value)
      return { outcome: 'ok', reply: false, read: () => fallback }
    }

    if (!registry.hostsUnit(uuid, unitId)) return refuseUnit(transport)
    if (!inRange) return { outcome: 'exception', code: ILLEGAL_DATA_ADDRESS, reply: true }

    // The request is whole and accepted here: nothing above read or wrote.
    if (values) {
      for (const [offset, value] of values.entries())
        registry.write(registerType, uuid, unitId, address + offset, value)
      return { outcome: 'ok', reply: true, read: () => fallback }
    }

    // An address inside the range with no entry is a register nobody
    // configured, and it answers 0 or false.
    return {
      outcome: 'ok',
      reply: true,
      read: (offset) => registry.read(uuid, unitId, registerType, address + offset) ?? fallback
    }
  }

  const answer = decide()
  requestLog.record({
    timestamp: Date.now(),
    uuid,
    unitId: request.unitId,
    direction: request.values ? 'write' : 'read',
    registerType: request.registerType,
    address: request.address,
    count: request.count,
    outcome: answer.outcome,
    ...(answer.outcome === 'exception' && { exceptionCode: answer.code }),
    ...(request.values && { values: request.values }),
    ...(fault && { fault })
  })
  return { answer, delayMs }
}

/**
 * How one accessor's callbacks are answered: `ok` for an accepted request at
 * an offset from its first address, `refuse` with a Modbus error.
 */
interface Replies<K extends RegisterType, C> {
  ok: (cb: C, answer: ServerAnswerOk<K>, offset: number) => void
  refuse: (cb: C, error: Error) => void
}

/**
 * Hands an answer to the callbacks modbus-serial gave for the request's
 * addresses, one per address for the bit accessors and one in all for the
 * others.
 *
 * An exception goes to the first callback alone, because the handler answers
 * the first error it is given and ignores the rest. Silence calls none, and
 * neither does an exception the handler has already sent.
 */
const answerNow = <K extends RegisterType, C>(
  answer: ServerAnswer<K>,
  callbacks: readonly C[],
  { ok, refuse }: Replies<K, C>
): void => {
  if (answer.outcome === 'no_response') return
  if (answer.outcome === 'exception') {
    if (!answer.reply) return
    for (const cb of callbacks.slice(0, 1)) refuse(cb, modbusError(answer.code))
    return
  }
  if (!answer.reply) return
  for (const [offset, cb] of callbacks.entries()) ok(cb, answer, offset)
}

/**
 * Answers callbacks the way the handler calls an accessor: inside try/catch,
 * and a throw is answered exception 4, which is what the handler's own catch
 * answers. A collected answer runs from a microtask and a delayed one from a
 * timer, and nothing of modbus-serial's would catch a throw from either.
 */
const guarded = <K extends RegisterType, C>({ ok, refuse }: Replies<K, C>): Replies<K, C> => ({
  ok: (cb, answer, offset): void => {
    try {
      ok(cb, answer, offset)
    } catch {
      refuse(cb, modbusError(SERVER_DEVICE_FAILURE))
    }
  },
  refuse: (cb, error): void => {
    try {
      refuse(cb, error)
    } catch {
      refuse(cb, modbusError(SERVER_DEVICE_FAILURE))
    }
  }
})

/**
 * Answers a request now, or once its delay has run out.
 *
 * The handler keeps the callbacks it handed over and the response buffer they
 * fill, and sends the frame from whichever call completes it, so a callback
 * called from a timer writes the same frame later. That timer runs outside
 * the handler's try/catch, so a delayed answer is `guarded`, the way a
 * collected one is.
 */
const reply = <K extends RegisterType, C>(
  { answer, delayMs }: ServedRequest<K>,
  callbacks: readonly C[],
  replies: Replies<K, C>
): void => {
  if (delayMs === undefined) return answerNow(answer, callbacks, replies)
  setTimeout(() => answerNow(answer, callbacks, guarded(replies)), delayMs)
}

/**
 * A refusal handing `value` beside the error, which is what the accessors
 * handed before they answered whole requests. The handler reads it on one path
 * only, which `getMultiple` explains.
 */
const refuseWith =
  <T>(value: T) =>
  (cb: FCallbackVal<T>, error: Error): void =>
    cb(error, value)

/** A write's acknowledgement, which carries nothing. */
const acknowledge = (cb: FCallback): void => cb(null)

/**
 * The single-address register read, FC3 or FC4 for one register.
 *
 * modbus-serial calls the multi-register accessor only when the count is above
 * one, so a one-register read arrives here and is a request of its own.
 *
 * Synchronous, like every accessor here that is not collected: the handler
 * calls a three-argument accessor inside try/catch and discards what it
 * returns, so a throw from `cb` is answered exception 4. An `async` accessor
 * throws into a rejection nothing holds, and the client waits out its timeout
 * instead.
 */
const get =
  (
    scope: VectorScope,
    registerType: 'input_registers' | 'holding_registers'
  ): IServiceVectorGet<number> =>
  (address, unitId, cb) =>
    reply(serve(scope, { unitId, registerType, address, count: 1 }, 0), [cb], {
      ok: (callback, answer) => callback(null, answer.read(0)),
      refuse: refuseWith(0)
    })

/**
 * The multi-register read, FC3 or FC4 for two registers or more.
 *
 * The error goes with an empty array rather than nothing: FC4's handler reads
 * `values[i]` on its error path too, and on `undefined` that throws, which it
 * answers exception 4 whatever code the error carried.
 */
const getMultiple =
  (
    scope: VectorScope,
    registerType: 'input_registers' | 'holding_registers'
  ): IServiceVectorGetMultiple =>
  (address, count, unitId, cb) =>
    reply(serve(scope, { unitId, registerType, address, count }, 0), [cb], {
      ok: (callback, answer) =>
        callback(
          null,
          Array.from({ length: count }, (_, offset) => answer.read(offset))
        ),
      refuse: refuseWith<number[]>([])
    })

/** The single-register write, FC6. */
const setRegister =
  (scope: VectorScope): IServiceVectorSet<number> =>
  (address, value, unitId, cb) =>
    reply(
      serve(
        scope,
        { unitId, registerType: 'holding_registers', address, count: 1, values: [value] },
        0
      ),
      [cb],
      { ok: acknowledge, refuse: refuseWith(0) }
    )

/** The multi-register write, FC16: every address or none. */
const setRegisterArray =
  (scope: VectorScope): IServiceVectorSet<number[]> =>
  (address, values, unitId, cb) =>
    reply(
      serve(
        scope,
        { unitId, registerType: 'holding_registers', address, count: values.length, values },
        0
      ),
      [cb],
      { ok: acknowledge, refuse: refuseWith(0) }
    )

/** One address of a bit request, as one accessor call handed it over. */
interface BitCall<V, C> {
  /** What a write carries at this address. */
  value: V
  cb: C
}

/** The calls of one bit request, collected until the run that made them ends. */
interface BitBatch<V, C> {
  unitId: number
  address: number
  nextAddress: number
  calls: BitCall<V, C>[]
}

/**
 * Collects the per-address calls of a bit accessor into requests.
 *
 * FC1, FC2, FC5 and FC15 reach the vector one address at a time. modbus-serial
 * has no whole-request accessor for the two reads, and the one for FC15 does
 * not work: its handler answers success before it calls `setCoilArray`, so
 * that accessor can neither refuse nor stay silent.
 *
 * The calls of one frame are made in one synchronous run, and modbus-serial
 * starts every frame from its own `setTimeout`, so the microtask queued by a
 * frame's first call runs after its last call and before the next frame. A
 * call that does not continue the open batch, another unit or an address that
 * is not the next one, starts a batch of its own.
 */
const collectBits = <V, C>(
  onRequest: (batch: BitBatch<V, C>) => void
): ((address: number, unitId: number, value: V, cb: C) => void) => {
  const queued: BitBatch<V, C>[] = []
  let open: BitBatch<V, C> | undefined

  const flush = (): void => {
    open = undefined
    for (const batch of queued.splice(0)) onRequest(batch)
  }

  return (address, unitId, value, cb) => {
    if (!open || open.unitId !== unitId || open.nextAddress !== address) {
      open = { unitId, address, nextAddress: address, calls: [] }
      queued.push(open)
      if (queued.length === 1) queueMicrotask(flush)
    }
    open.calls.push({ value, cb })
    open.nextAddress = address + 1
  }
}

/** A bit read, FC1 or FC2, answered once the request's last address has arrived. */
const getBits = (
  scope: VectorScope,
  registerType: 'coils' | 'discrete_inputs'
): IServiceVectorGet<boolean> => {
  const collect = collectBits<undefined, FCallbackVal<boolean>>(({ unitId, address, calls }) =>
    reply(
      serve(scope, { unitId, registerType, address, count: calls.length }, false),
      calls.map(({ cb }) => cb),
      guarded({
        ok: (cb, answer, offset) => cb(null, answer.read(offset)),
        refuse: refuseWith(false)
      })
    )
  )
  return (address, unitId, cb) => collect(address, unitId, undefined, cb)
}

/** A coil write, FC5 or FC15, answered once the request's last address has arrived. */
const setCoils = (scope: VectorScope): IServiceVectorSet<boolean> => {
  const collect = collectBits<boolean, FCallback>(({ unitId, address, calls }) => {
    const values = calls.map(({ value }) => value)
    reply(
      serve(scope, { unitId, registerType: 'coils', address, count: values.length, values }, false),
      calls.map(({ cb }) => cb),
      guarded({ ok: acknowledge, refuse: refuseWith(0) })
    )
  })
  return (address, value, unitId, cb) => collect(address, unitId, value, cb)
}

/**
 * The accessors modbus-serial calls when a frame arrives.
 *
 * Built once per listener and bound to a uuid, and each request reads the
 * registry when it arrives. That is why a register added after a server is up
 * needs no rebind.
 */
export const createVector = (
  stores: VectorStores,
  uuid: string,
  transport: ServerTransport
): IServiceVector => {
  const scope: VectorScope = { ...stores, uuid, transport }
  return {
    getCoil: getBits(scope, 'coils'),
    getDiscreteInput: getBits(scope, 'discrete_inputs'),
    getInputRegister: get(scope, 'input_registers'),
    getHoldingRegister: get(scope, 'holding_registers'),
    getMultipleInputRegisters: getMultiple(scope, 'input_registers'),
    getMultipleHoldingRegisters: getMultiple(scope, 'holding_registers'),
    setCoil: setCoils(scope),
    setRegister: setRegister(scope),
    setRegisterArray: setRegisterArray(scope)
  }
}
