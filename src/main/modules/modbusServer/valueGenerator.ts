import {
  ByteOrderFlags,
  DEFAULT_UTF8_LENGTH,
  NumberRegisters,
  RegisterParamsGeneratorPart,
  RegisterParamsBasePart,
  ServerData,
  RegisterParams,
  RegisterValueGenerator,
  registerWidth,
  UnitIdString,
  ValuedDataType,
  nextRampTick,
  RampSpec
} from '@shared'
import { Windows } from '../../windows'
import { encodeRegisters, writeRegisters } from './registers'
import { round } from 'lodash'

type ValueGeneratorParams = {
  uuid: string
  unitId: UnitIdString
  windows: Windows
  serverData: ServerData
  order: ByteOrderFlags
  // `ServerRegistry.addRegister` answers `none` before it gets here, because an
  // address held open with nothing in it has nothing to generate.
  dataType: ValuedDataType
} & RegisterParamsGeneratorPart &
  Omit<RegisterParamsBasePart, 'dataType'>

/**
 * ValueGenerator generates and updates Modbus register values at a set interval.
 * It supports various data types and updates the server data and notifies the frontend.
 */
export class ValueGenerator implements RegisterValueGenerator {
  private _uuid: string
  private _unitId: UnitIdString
  private _windows: Windows
  private _serverData: ServerData
  private _registerType: NumberRegisters
  private _address: number
  private _dataType: ValuedDataType
  private _min: number
  private _max: number
  private _order: ByteOrderFlags
  private _interval: number
  private _comment: string
  private _stringValue: string
  private _length: number
  private _intervalTimer: NodeJS.Timeout
  /** `undefined` for a random generator. */
  private _ramp: RampSpec | undefined
  /** Steps the ramp has taken since it last left `start`. */
  private _stepCount = 0

  /**
   * Constructs a ValueGenerator.
   * @param params - All parameters required for value generation and server data update.
   */
  constructor({
    uuid,
    unitId,
    windows,
    serverData,
    registerType,
    address,
    dataType,
    min,
    max,
    order,
    interval,
    comment,
    stringValue,
    length,
    mode,
    start,
    step,
    restart
  }: ValueGeneratorParams) {
    this._uuid = uuid
    this._unitId = unitId
    this._windows = windows
    this._serverData = serverData
    this._address = address
    this._dataType = dataType
    this._min = min
    this._max = max
    this._order = order
    this._registerType = registerType
    this._interval = interval
    this._comment = comment
    this._stringValue = stringValue ?? ''
    this._length = length ?? DEFAULT_UTF8_LENGTH
    // `RegisterParamsSchema` refuses a ramp without `start` or `step`; one
    // constructed directly without them runs as a random generator.
    this._ramp =
      mode === 'ramp' && start !== undefined && step !== undefined
        ? {
            start,
            step,
            min,
            max,
            restart: restart ?? true
          }
        : undefined

    // Set initial value and start periodic updates
    if (this._ramp) this._updateServerData(this._ramp.start)
    else this._updateValue()
    this._intervalTimer = setInterval(this._updateValue, interval)
  }

  /**
   * Disposes the generator: stops the interval and resets the register values to 0.
   */
  public dispose = (): void => {
    clearInterval(this._intervalTimer)

    // The words go rather than turn zero. A read answers 0 for an address with
    // no entry, so the two are the same answer and only one of them is stored.
    const size = registerWidth(this._dataType, this._length)

    for (let i = 0; i < size; i++) {
      this._serverData[this._registerType].delete(this._address + i)
    }
  }

  /**
   * Updates the value in the server data and notifies the frontend.
   */
  private _updateServerData = (value: number): void => {
    writeRegisters({
      windows: this._windows,
      serverData: this._serverData,
      uuid: this._uuid,
      unitId: this._unitId,
      registerType: this._registerType,
      address: this._address,
      registers: encodeRegisters({
        dataType: this._dataType,
        value,
        order: this._order,
        stringValue: this._stringValue,
        length: this._length
      })
    })
  }

  /**
   * Generates a new value and updates the server data.
   *
   * Synchronous: the constructor and `setInterval` both call this without
   * awaiting it, so an `async` one turns a throw into a rejection nothing
   * holds.
   */
  private _updateValue = (): void => {
    if (this._ramp) {
      this._updateRamp(this._ramp)
      return
    }
    switch (this._dataType) {
      case 'unix': {
        // Generator: current system time (seconds since epoch)
        this._updateServerData(Math.floor(Date.now() / 1000))
        break
      }
      case 'datetime': {
        // Generator: current system time (milliseconds for IEC 870 encoding)
        this._updateServerData(Date.now())
        break
      }
      case 'utf8': {
        // UTF-8 is always fixed — write once, no periodic changes
        this._updateServerData(0)
        break
      }
      default: {
        // Numeric random value
        const decimals = ['float', 'double'].includes(this._dataType) ? 2 : 0
        const value = round(Math.random() * (this._max - this._min) + this._min, decimals)
        this._updateServerData(value)
      }
    }
  }

  /**
   * Writes the ramp's next tick. A `hold` clears the timer, so a ramp with
   * restart off writes nothing after it reaches its bound.
   */
  private _updateRamp = (ramp: RampSpec): void => {
    const tick = nextRampTick(ramp, this._stepCount)
    if (tick.kind === 'hold') {
      clearInterval(this._intervalTimer)
      return
    }
    this._stepCount = tick.stepCount
    this._updateServerData(tick.value)
  }

  /**
   * Returns the parameters needed to reconstruct this generator.
   */
  get params(): RegisterParams {
    return {
      address: this._address,
      registerType: this._registerType,
      dataType: this._dataType,
      min: this._min,
      max: this._max,
      interval: this._interval,
      comment: this._comment,
      ...(this._ramp
        ? {
            mode: 'ramp' as const,
            start: this._ramp.start,
            step: this._ramp.step,
            restart: this._ramp.restart
          }
        : {}),
      ...(this._dataType === 'utf8' ? { stringValue: this._stringValue, length: this._length } : {})
    }
  }
}
