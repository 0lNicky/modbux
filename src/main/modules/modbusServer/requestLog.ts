import { RegisterType } from '@shared'

/** How many requests each server keeps, the same as the client's transaction list. */
export const SERVER_REQUEST_LOG_LIMIT = 1000

/**
 * What the master got back.
 *
 * `ok` is a reply with the data or the acknowledgement, apart from an RTU
 * broadcast write: it is written and gets no reply, because a broadcast never
 * gets one, and it is recorded `ok` because nothing failed.
 */
export type ServerRequestOutcome = 'ok' | 'exception' | 'no_response'

/** The fault rule that decided a request, which `serve` in `vector.ts` records. */
export interface ServerRequestFault {
  /** The rule's index in the server's list, 0 for the first. */
  rule: number
  /** How long the reply was held back, for a delay rule. An RTU broadcast has no reply to hold. */
  delayMs?: number
}

/** One request a master sent a server, whole: one frame, however many addresses. */
export interface ServerRequest {
  timestamp: number
  uuid: string
  /** The unit id as the frame carried it, which on RTU includes 0, the broadcast. */
  unitId: number
  direction: 'read' | 'write'
  registerType: RegisterType
  /** The first address, as a PDU address. */
  address: number
  count: number
  outcome: ServerRequestOutcome
  /** The Modbus exception code, when `outcome` is `exception`. */
  exceptionCode?: number
  /** What a write carried, one entry per address. */
  values?: (number | boolean)[]
  fault?: ServerRequestFault
}

export interface ServerRequestFilter {
  /** The newest this many, after the other filters. */
  limit: number
  /** Only requests at or after this time, in milliseconds since the epoch. */
  sinceTimestamp?: number
  /** Only requests that got an exception or no reply. */
  failedOnly?: boolean
}

/**
 * The newest requests each server answered, kept in main's memory only.
 *
 * Nothing persists it, and deleting a server deletes its list.
 */
export class ServerRequestLog {
  private _requests: Map<string, ServerRequest[]> = new Map()

  public record(request: ServerRequest): void {
    const requests = this._requests.get(request.uuid) ?? []
    requests.push(request)
    if (requests.length > SERVER_REQUEST_LOG_LIMIT) requests.shift()
    this._requests.set(request.uuid, requests)
  }

  /** The requests `uuid` answered that pass `filter`, oldest first. */
  public list(
    uuid: string,
    { limit, sinceTimestamp, failedOnly }: ServerRequestFilter
  ): ServerRequest[] {
    const matching = (this._requests.get(uuid) ?? []).filter(
      (request) =>
        (sinceTimestamp === undefined || request.timestamp >= sinceTimestamp) &&
        (!failedOnly || request.outcome !== 'ok')
    )
    return matching.slice(-limit)
  }

  public delete(uuid: string): void {
    this._requests.delete(uuid)
  }
}
