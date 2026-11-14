import {
  RemoveRegisterParams,
  SetBooleanParameters,
  SyncBoolsParameters,
  SyncRegisterValueParams,
  ResetRegistersParams,
  ResetBoolsParams,
  CreateServerParams,
  AddRegisterParams,
  StartRtuServerParams,
  ServerEndianness,
  NumberRegisters,
  UnitIdString,
  MAIN_SERVER_UUID,
  ServerFaultRule,
  ServerFaultRuleStatus
} from '@shared'
import { Windows } from '../windows'
import { ServerFaults } from './modbusServer/faults'
import { ServerRegistry } from './modbusServer/registry'
import { ServerRequest, ServerRequestFilter, ServerRequestLog } from './modbusServer/requestLog'
import { RtuServer } from './modbusServer/rtu'
import { TcpServers } from './modbusServer/tcp'

interface ServerParams {
  windows: Windows
}

/** What `dropConnections` did: how many connections it closed, or why it closed none. */
export type DropConnectionsOutcome = { dropped: number } | { error: string }

/**
 * The six parts of a Modbus server, and what one uuid means across them.
 *
 * `ServerRegistry` holds the registers, `TcpServers` holds the listeners,
 * `RtuServer` holds the serial port, `createVector` is what the two transports
 * ask the registry through, `ServerRequestLog` holds what the vectors
 * answered, and `ServerFaults` holds the rules the vectors ask first.
 * Everything public here is what `main/ipc.ts` or the MCP tools call; a method
 * that names more than one part is one this class answers itself, and the rest
 * hand their parameters over.
 */
export class ModbusServer {
  /** What every server holds, keyed by uuid and then by unit id. */
  private _registry: ServerRegistry

  /** The requests each uuid answered, which both transports' vectors record. */
  private _requestLog: ServerRequestLog = new ServerRequestLog()

  /** The fault rules of each uuid, which both transports' vectors ask. */
  private _faults: ServerFaults

  /** The TCP listeners, one per uuid. */
  private _tcp: TcpServers

  /** The one RTU server, and the uuid whose registers it serves. */
  private _rtu: RtuServer

  /** Whether the RTU server is running, for a window that has to ask. */
  public get rtuActive(): boolean {
    return this._rtu.active
  }

  /**
   * Construct a ModbusServer instance.
   * @param windows - Windows IPC interface for backend/frontend communication.
   */
  constructor({ windows }: ServerParams) {
    // The registry's callback names `_rtu`, so the RTU server is built before
    // anything that could write a register. Nothing here does today, and the
    // order is what keeps that from mattering.
    this._registry = new ServerRegistry({
      windows,
      onUnitData: (uuid): void => this._rtu.warnBroadcastUnit(uuid)
    })
    // Every window is told, because both draw the server view and a split out
    // window can close while the rules stay.
    this._faults = new ServerFaults({
      onChange: (uuid, rules): void => windows.send('server_faults', { uuid, rules })
    })
    const stores = { registry: this._registry, requestLog: this._requestLog, faults: this._faults }
    this._rtu = new RtuServer({ windows, ...stores })
    this._tcp = new TcpServers({ windows, ...stores })
  }

  /**
   * The words `count` registers from `address` hold, as a master's read gets
   * them: 0 where nothing was written, as the vector answers.
   */
  public readRegisters = (
    uuid: string,
    unitId: UnitIdString,
    registerType: NumberRegisters,
    address: number,
    count: number
  ): number[] =>
    Array.from(
      { length: count },
      (_, offset) => this._registry.read(uuid, unitId, registerType, address + offset) ?? 0
    )

  /** The requests a master sent `uuid` that pass `filter`, oldest first. */
  public getRequests = (uuid: string, filter: ServerRequestFilter): ServerRequest[] =>
    this._requestLog.list(uuid, filter)

  /**
   * Whether main serves `uuid`: the main server always, another one while it
   * has a TCP listener or the RTU server answers for it.
   */
  public hasServer = (uuid: string): boolean =>
    uuid === MAIN_SERVER_UUID || this._tcp.portOf(uuid) !== undefined || this._rtu.uuid === uuid

  /** Replaces `uuid`'s fault rules, and answers the list now in effect. */
  public setFaults = (uuid: string, rules: ServerFaultRule[]): ServerFaultRule[] =>
    this._faults.set(uuid, rules)

  /** `uuid`'s fault rules, each with how often it matched and fired. */
  public getFaults = (uuid: string): ServerFaultRuleStatus[] => this._faults.status(uuid)

  /** Every server that has fault rules, with its list, for a window catching up. */
  public allFaults = (): Record<string, ServerFaultRule[]> => this._faults.all()

  /** Removes every fault rule of `uuid`. */
  public clearFaults = (uuid: string): void => this._faults.clear(uuid)

  /**
   * Closes every connection a master has open to `uuid`, and keeps the listener.
   *
   * The RTU server has no connection to close: a serial line is one bus, and
   * closing the port would stop the server.
   */
  public dropConnections = (uuid: string): DropConnectionsOutcome => {
    const dropped = this._tcp.dropConnections(uuid)
    if (dropped !== undefined) return { dropped }
    if (this._rtu.uuid === uuid) {
      return { error: 'The server runs on RTU, which has no connections to drop' }
    }
    return { error: `The server ${uuid} has no TCP listener` }
  }

  /** Binds a listener for a uuid, and answers the port it took. */
  public createServer = (params: CreateServerParams): Promise<number | undefined> =>
    this._tcp.create(params)

  /**
   * Deletes a server for the given UUID, releasing everything held under it.
   *
   * What the uuid holds goes first, whether or not a TCP listener was ever
   * bound. The registry holds every register of every unit id under the uuid,
   * and the delete button does not go through `resetServer`, which is the other
   * place that frees it.
   *
   * A uuid with no listener is silence rather than an error: a server whose
   * bind was refused keeps `ready` false in the store and its Delete button,
   * and it is still a server the user is deleting.
   */
  public deleteServer = async (uuid: string): Promise<void> => {
    // Clean up RTU server if this UUID is the RTU server
    if (this._rtu.uuid === uuid) {
      await this._rtu.stop()
    }

    this._registry.deleteUuid(uuid)
    this._requestLog.delete(uuid)
    this._faults.clear(uuid)

    await this._tcp.closeAndForget(uuid)
  }

  /**
   * Resets the server for a given UUID: disposes its value generators and
   * clears its register data.
   *
   * The vectors read the registry per request, so the cleared data is what a
   * master gets from the listener that is already up.
   *
   * `create` rebinds nothing from here. It writes `_port` and `_servers` on
   * consecutive lines and `closeAndForget` deletes both, so a stored port means
   * a listener on that port, which is `create`'s first return. After a spell in
   * RTU mode there is no stored port and the call does not happen at all.
   */
  public resetServer = async (uuid: string): Promise<void> => {
    this._registry.clearData(uuid)
    const port = this._tcp.portOf(uuid)
    if (port) await this._tcp.create({ uuid, port })
  }

  /** Moves a uuid to the exact port asked for, or says why it did not. */
  public setPort = (params: CreateServerParams): Promise<number> => this._tcp.setPort(params)

  /** Closes every TCP listener and keeps the registers for a restore. */
  public stopAllTcpServers = (): Promise<void> => this._tcp.stopAll()

  /** Sets the byte order this server encodes its registers in. */
  public setEndianness = (params: ServerEndianness): void => this._registry.setEndianness(params)

  /** Adds a register or value generator, and answers the words it now holds. */
  public addRegister = (params: AddRegisterParams): number[] | undefined =>
    this._registry.addRegister(params)

  /** Removes a register or value generator. */
  public removeRegister = (params: RemoveRegisterParams): void =>
    this._registry.removeRegister(params)

  /** Replaces every register of a unit with the ones given. */
  public syncServerRegisters = (params: SyncRegisterValueParams): void =>
    this._registry.syncServerRegisters(params)

  /** Clears one register type of a unit, generators and all. */
  public resetRegisters = (params: ResetRegistersParams): void =>
    this._registry.resetRegisters(params)

  /** Sets a coil or a discrete input. */
  public setBool = (params: SetBooleanParameters): void => this._registry.setBool(params)

  /** Clears every coil or every discrete input of a unit. */
  public resetBools = (params: ResetBoolsParams): void => this._registry.resetBools(params)

  /** Replaces both bool maps of a unit with what the renderer holds. */
  public syncBools = (params: SyncBoolsParameters): void => this._registry.syncBools(params)

  /** Starts an RTU server on a serial port for the given UUID. */
  public startRtuServer = (params: StartRtuServerParams): Promise<void> => this._rtu.start(params)

  /** Stops the active RTU server if one is running. */
  public stopRtuServer = (): Promise<void> => this._rtu.stop()
}
