import {
  RegisterType,
  ServerFaultAction,
  ServerFaultRule,
  ServerFaultRuleStatus,
  ServerFaultStatus
} from '@shared'

/** A request as a fault rule reads it: whole, before anything is read or written. */
export interface FaultRequest {
  unitId: number
  registerType: RegisterType
  address: number
  count: number
  direction: 'read' | 'write'
}

/** The rule that decided a request: its index in the list, and what it does. */
export interface AppliedFault {
  rule: number
  action: ServerFaultAction
}

/** A rule with what it has done since it was set. */
interface RuleEntry {
  rule: ServerFaultRule
  matched: number
  triggered: number
  expiresAt?: number
}

interface ServerFaultsParams {
  /** Called with a server's whole list and its new version each time it changes, emptied included. */
  onChange: (uuid: string, rules: ServerFaultRule[], version: number) => void
}

const matches = (rule: ServerFaultRule, request: FaultRequest): boolean => {
  if (rule.unitId !== undefined && rule.unitId !== request.unitId) return false
  if (rule.registerType !== undefined && rule.registerType !== request.registerType) return false
  if (rule.direction !== undefined && rule.direction !== request.direction) return false
  if (rule.addressRange !== undefined) {
    const [start, end] = rule.addressRange
    const last = request.address + request.count - 1
    if (last < start || request.address > end) return false
  }
  return true
}

/**
 * Each server's fault rules, kept in main's memory only.
 *
 * Nothing persists them: a restart starts with none, and `ModbusServer` clears
 * a server's list when the server is deleted. The renderer clears it when a
 * config or project file is loaded onto the server.
 */
export class ServerFaults {
  private _onChange: ServerFaultsParams['onChange']
  private _entries: Map<string, RuleEntry[]> = new Map()
  /** The `forSeconds` timers of each server's list, cancelled when the list goes. */
  private _timers: Map<string, ReturnType<typeof setTimeout>[]> = new Map()
  /**
   * Each server's list version. One counter serves every server and only
   * grows, so a uuid never answers a version it answered before, even after its
   * list emptied or the server was deleted.
   */
  private _versions: Map<string, number> = new Map()
  private _lastVersion = 0

  constructor({ onChange }: ServerFaultsParams) {
    this._onChange = onChange
  }

  /** The version of `uuid`'s list, which every change to the list replaces. 0 for one never changed. */
  public version(uuid: string): number {
    return this._versions.get(uuid) ?? 0
  }

  /**
   * Replaces `uuid`'s list with `rules` only while it is still at `version`,
   * and says whether it did. A window sends the version its list was read at,
   * so a list main changed since is refused instead of written back over.
   */
  public replace(uuid: string, version: number, rules: ServerFaultRule[]): boolean {
    if (version !== this.version(uuid)) return false
    this.set(uuid, rules)
    return true
  }

  /** Replaces `uuid`'s list with `rules`, counts reset, and answers it. */
  public set(uuid: string, rules: ServerFaultRule[]): ServerFaultRule[] {
    this._cancelTimers(uuid)
    const now = Date.now()
    const entries: RuleEntry[] = rules.map((rule) => ({
      rule,
      matched: 0,
      triggered: 0,
      ...(rule.forSeconds !== undefined && { expiresAt: now + rule.forSeconds * 1000 })
    }))
    if (entries.length === 0) this._entries.delete(uuid)
    else this._entries.set(uuid, entries)

    // The timer removes its own entry by identity, because an earlier expiry
    // moves every index after it.
    const timers = entries.flatMap((entry) =>
      entry.rule.forSeconds === undefined
        ? []
        : [setTimeout(() => this._expire(uuid, entry), entry.rule.forSeconds * 1000)]
    )
    if (timers.length > 0) this._timers.set(uuid, timers)

    this._onChange(uuid, rules, this._nextVersion(uuid))
    return rules
  }

  /** The rules `uuid` holds now. */
  public list(uuid: string): ServerFaultRule[] {
    return (this._entries.get(uuid) ?? []).map(({ rule }) => rule)
  }

  /** The rules `uuid` holds now, each with what it has done. */
  public status(uuid: string): ServerFaultRuleStatus[] {
    return (this._entries.get(uuid) ?? []).map(({ rule, matched, triggered, expiresAt }) => ({
      ...rule,
      matched,
      triggered,
      ...(expiresAt !== undefined && { expiresAt })
    }))
  }

  /** The rules `uuid` holds now with what each has done, and the version of that list. */
  public snapshot(uuid: string): Omit<ServerFaultStatus, 'exists'> {
    return { version: this.version(uuid), rules: this.status(uuid) }
  }

  /** Every server that holds rules, with its list. */
  public all(): Record<string, ServerFaultRule[]> {
    return Object.fromEntries(
      [...this._entries.keys()].map((uuid) => [uuid, this.list(uuid)] as const)
    )
  }

  /** Empties `uuid`'s list. A server holding none is told nothing. */
  public clear(uuid: string): void {
    if (!this._entries.has(uuid)) return
    this.set(uuid, [])
  }

  /**
   * Empties a deleted server's list. The version changes even when it held no
   * rules, so a window still holding the deleted server's list cannot write to
   * its uuid.
   */
  public forget(uuid: string): void {
    if (this._entries.has(uuid)) this.set(uuid, [])
    else this._nextVersion(uuid)
  }

  /**
   * The rule that decides `request`, or undefined where the server answers it
   * as it would without rules.
   *
   * The first rule that matches is the request's rule, and its trigger alone
   * says whether it fires: a match `everyNth` does not fire on is served as
   * usual and goes to no later rule, so the rules after it never see it.
   */
  public decide(uuid: string, request: FaultRequest): AppliedFault | undefined {
    const entries = this._entries.get(uuid) ?? []
    const index = entries.findIndex(({ rule }) => matches(rule, request))
    const entry = entries[index]
    if (!entry) return undefined

    entry.matched += 1
    if (entry.matched % (entry.rule.everyNth ?? 1) !== 0) return undefined
    entry.triggered += 1
    return { rule: index, action: entry.rule.action }
  }

  private _expire(uuid: string, expired: RuleEntry): void {
    const remaining = (this._entries.get(uuid) ?? []).filter((entry) => entry !== expired)
    if (remaining.length === 0) {
      this._entries.delete(uuid)
      this._timers.delete(uuid)
    } else {
      this._entries.set(uuid, remaining)
    }
    this._onChange(uuid, this.list(uuid), this._nextVersion(uuid))
  }

  private _nextVersion(uuid: string): number {
    this._lastVersion += 1
    this._versions.set(uuid, this._lastVersion)
    return this._lastVersion
  }

  private _cancelTimers(uuid: string): void {
    for (const timer of this._timers.get(uuid) ?? []) clearTimeout(timer)
    this._timers.delete(uuid)
  }
}
