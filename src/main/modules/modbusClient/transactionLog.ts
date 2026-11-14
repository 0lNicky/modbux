import { MAX_TRANSACTIONS, RawTransaction, Transaction } from '@shared'
import { DateTime } from 'luxon'
import ModbusRTU from 'modbus-serial'
import { v4 } from 'uuid'
import { Windows } from '../../windows'

/** Modbus frames read the way a protocol analyser prints them. */
const toHexString = (bytes: Uint8Array | undefined): string =>
  bytes === undefined
    ? ''
    : Array.from(bytes)
        .map((byte) => Number(byte).toString(16).toUpperCase().padStart(2, '0'))
        .join(' ')

/**
 * The two internals the transaction log reads.
 *
 * `ModbusRTU.d.ts` declares neither, so both arrive untyped and the shape is
 * written here. `_transactions` is the table every request is filed in, and
 * `_port._transactionIdWrite` is the key the next one files under.
 *
 * Both optionals describe modbus-serial rather than guarding anything here. A
 * client built but not connected has no `_port` at all, and a serial port has
 * no `_transactionIdWrite` until `open` sets it. `nextTransactionIdKey` runs
 * behind `_requireConnected`, so it meets neither state.
 */
interface ModbusRTUInternals extends ModbusRTU {
  _transactions: Record<string, RawTransaction | undefined>
  _port: { _transactionIdWrite?: number } | undefined
}

/**
 * The data address the request asked for.
 *
 * Read off the request frame, not off `nextDataAddress`. modbus-serial files
 * that field on two of its twelve transaction records, inside `writeFC4` and
 * `writeFC6`, and `writeFC1` delegates to `writeFC2` while `writeFC3`
 * delegates to `writeFC4`. So FC3, FC4 and FC6 carry one and FC1, FC2, FC5,
 * FC15 and FC16 do not, and the Addr column was blank for every coil read,
 * every discrete input read and every write Modbux sends.
 *
 * Every `writeFCx` builds its frame as unit id, function code, then the data
 * address at offset 2 as a big-endian word: measured over FC2, FC4, FC5, FC6,
 * FC15 and FC16, which is every code Modbux sends. `request` is stashed by
 * `_writeBufferToPort` while debug mode is on, and `connect` sets
 * `isDebugEnabled` on every client it opens, including the replacement the
 * disconnect timeout builds, so a frame that went out over a connection this
 * file made has one. `nextDataAddress` is the fallback either way.
 */
const requestedAddress = (rawTransaction: RawTransaction): number | undefined => {
  const request = rawTransaction.request
  if (request && request.length >= 4) return request.readUInt16BE(2)
  return rawTransaction.nextDataAddress
}

/**
 * The exception code a response carries, and undefined for any other response.
 *
 * A response is an exception when its function code has the high bit set, and
 * the byte after the function code is the exception code. The frame is unit id,
 * function code, data, CRC on every protocol: modbus-serial's TCP port strips
 * the MBAP header before it emits a response and adds one only on the way out
 * (`tcpport.js`), so the function code is byte 1 on TCP as on RTU.
 */
export const exceptionCodeOf = (responses: readonly string[]): number | undefined => {
  for (const response of responses) {
    const bytes = Buffer.from(response.replace(/ /g, ''), 'hex')
    const [, functionCode, exceptionCode] = bytes
    if (functionCode !== undefined && functionCode >= 0x80) return exceptionCode
  }
  return undefined
}

/** A transaction as main keeps it: what the window gets, and what main read off the frame. */
export type LoggedTransaction = Transaction & { exceptionCode?: number }

export interface TransactionQuery {
  /** The newest `limit` that match. Without it, all of them. */
  limit?: number
  /** Only transactions logged at or after this time. */
  sinceTimestamp?: number
  /** Only a timeout, an error message or an exception. */
  failedOnly?: boolean
  /** Only transactions logged after `mark()` answered this. */
  afterMark?: number
}

interface TransactionLogParams {
  /**
   * The client as it is now, not as it was.
   *
   * `ModbusClient.disconnect` builds a replacement `ModbusRTU` when a close
   * times out, so a reference taken once would read the table of a client
   * nothing sends on any more.
   */
  client: () => ModbusRTU
  windows: Windows
}

/**
 * What went out and what came back, read off modbus-serial's own table.
 *
 * This is the only part of the client that names an undeclared internal, which
 * is what a library bump breaks.
 */
export class TransactionLog {
  private _client: () => ModbusRTU
  private _windows: Windows

  /** Oldest first, at most `MAX_TRANSACTIONS`. */
  private _recent: LoggedTransaction[] = []
  /** Every transaction ever logged, so a mark survives the cap dropping the oldest. */
  private _logged = 0
  /** When each key was handed out, which is when its request goes out. */
  private _startedAt = new Map<string, number>()

  constructor({ client, windows }: TransactionLogParams) {
    this._client = client
    this._windows = windows
  }

  // The key is a transaction id on TCP and UDP, whose ports write it into the
  // MBAP header and increment it per request. A serial port has none: RTU
  // frames carry no transaction id, and `rtubufferedport.js` never names
  // `_transactionIdWrite`. `open` sets it to 1 for every transport
  // (`index.js:679`), so every serial request files under the key 1 and the
  // next one lands on top of the last. It is a map key, not a number.
  private _internals = (): ModbusRTUInternals => this._client() as ModbusRTUInternals

  /**
   * The key modbus-serial files the next request under.
   *
   * A `writeFCx` reads `_port._transactionIdWrite` to file its transaction and
   * the port increments it once the buffer is out, so this is the key of the
   * request that goes next. Read it immediately before the call: nothing awaits
   * in between, so nothing else can file first.
   */
  public nextTransactionIdKey = (): string => {
    const transactionIdKey = String(this._internals()._port?._transactionIdWrite)
    // A key handed out and never logged stays here, and a TCP key is new every
    // time, so the oldest goes once there are as many as the log holds.
    if (this._startedAt.size >= MAX_TRANSACTIONS) {
      for (const oldest of this._startedAt.keys()) {
        this._startedAt.delete(oldest)
        break
      }
    }
    this._startedAt.set(transactionIdKey, Date.now())
    return transactionIdKey
  }

  /** A position in the log: what `list({ afterMark })` counts from. */
  public mark = (): number => this._logged

  /** The transactions that match `query`, oldest first. */
  public list = ({
    limit,
    sinceTimestamp,
    failedOnly,
    afterMark
  }: TransactionQuery = {}): LoggedTransaction[] => {
    const matching = this._recent
      .slice(Math.max(0, (afterMark ?? 0) - (this._logged - this._recent.length)))
      .filter(
        (transaction) =>
          (sinceTimestamp === undefined || transaction.timestamp >= sinceTimestamp) &&
          (!failedOnly ||
            transaction.errorMessage !== undefined ||
            transaction.timeout ||
            transaction.exceptionCode !== undefined)
      )
    return limit === undefined ? matching : matching.slice(Math.max(0, matching.length - limit))
  }

  /**
   * Log the request filed under `transactionIdKey`, and only that one.
   *
   * The caller names its own request because the table holds whatever earlier
   * requests were never logged out of it. Taking the last entry instead logged
   * one caller's frame as another's and deleted the entry that caller was
   * still waiting on.
   *
   * On a serial port that key is 1 for every request, so naming it
   * discriminates nothing and the delete below would take an entry still in
   * flight. What keeps them apart there is that there is only ever one:
   * `write` and `read` are both refused while `_clientOwner` answers, and a
   * poll awaits each request before it sends the next.
   */
  public log = (transactionIdKey: string, errorMessage: string | undefined): void => {
    const rawTransactions = this._internals()._transactions
    const rawTransaction = rawTransactions[transactionIdKey]
    if (!rawTransaction) return

    // Only the entry being logged, so the same one is not logged again on the
    // next call. Emptying the table takes entries for requests still in flight
    // with it, and `_onReceive` drops a response whose entry is gone, so the
    // request times out rather than resolving.
    delete rawTransactions[transactionIdKey]

    const now = DateTime.now().toMillis()
    const startedAt = this._startedAt.get(transactionIdKey)
    this._startedAt.delete(transactionIdKey)

    const transaction: Transaction = {
      id: `${transactionIdKey}__${v4()}`,
      timestamp: now,
      unitId: rawTransaction.nextAddress,
      address: requestedAddress(rawTransaction),
      code: rawTransaction.nextCode,
      responseLength: rawTransaction.nextLength,
      timeout: rawTransaction._timeoutFired,
      request: toHexString(rawTransaction.request),
      responses: (rawTransaction.responses ?? []).map(toHexString),
      errorMessage,
      durationMs: startedAt === undefined ? undefined : now - startedAt
    }

    const exceptionCode = exceptionCodeOf(transaction.responses)
    this._recent.push(exceptionCode === undefined ? transaction : { ...transaction, exceptionCode })
    this._logged += 1
    if (this._recent.length > MAX_TRANSACTIONS) this._recent.shift()

    this._windows.send('transaction', transaction, 'main')
  }
}
