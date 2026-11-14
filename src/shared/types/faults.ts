import z from 'zod'
import { RegisterAddressSchema, UnitIdSchema } from './ranges'
import { RegisterTypeSchema } from './register'
import { ServerUuidSchema } from './server'

/**
 * The longest a `delay` rule holds a reply back: six times the Modbux client's
 * default timeout of 5000 ms (`shared/default.ts`), so a delay can outlast any
 * timeout a master is likely to set.
 */
export const FAULT_DELAY_MAX_MS = 30_000

/** The longest a `forSeconds` rule lives, one day. */
export const FAULT_FOR_SECONDS_MAX = 86_400

/**
 * What a rule does to a request it decides.
 *
 * `exception` answers that code and `no_response` answers nothing, and neither
 * writes. `delay` reads and writes as the server would and answers `ms` later.
 */
export const ServerFaultActionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('exception'), code: z.number().int().min(1).max(255) }),
  z.object({ kind: z.literal('no_response') }),
  z.object({ kind: z.literal('delay'), ms: z.number().int().min(1).max(FAULT_DELAY_MAX_MS) })
])
export type ServerFaultAction = z.infer<typeof ServerFaultActionSchema>

/**
 * One fault rule of a server. A condition left out matches every request.
 *
 * A request matches `addressRange` when any of its addresses is inside it, both
 * ends included. `everyNth` counts the requests that match this rule, and the
 * rule decides the Nth, the 2Nth and so on. `forSeconds` removes the rule that
 * many seconds after it was set.
 */
export const ServerFaultRuleSchema = z.object({
  unitId: UnitIdSchema.optional(),
  registerType: RegisterTypeSchema.optional(),
  addressRange: z
    .tuple([RegisterAddressSchema, RegisterAddressSchema])
    .refine(([start, end]) => start <= end, 'addressRange starts after it ends')
    .optional(),
  direction: z.enum(['read', 'write']).optional(),
  action: ServerFaultActionSchema,
  everyNth: z.number().int().min(1).optional(),
  forSeconds: z.number().positive().max(FAULT_FOR_SECONDS_MAX).optional()
})
export type ServerFaultRule = z.infer<typeof ServerFaultRuleSchema>

/** How many rules one server takes. A list is read in order, so a long one is a mistake. */
export const MAX_FAULT_RULES = 32

/**
 * `set_server_faults`: the whole list one server holds from now on, and the
 * version of the list it was built from. Main takes it only while its list is
 * still at that version.
 */
export const SetServerFaultsParamsSchema = z.object({
  uuid: ServerUuidSchema,
  version: z.number().int().nonnegative(),
  rules: z.array(ServerFaultRuleSchema).max(MAX_FAULT_RULES)
})
export type SetServerFaultsParams = z.infer<typeof SetServerFaultsParamsSchema>

/** A rule as `server_get_faults` answers it, with what it has done so far. */
export type ServerFaultRuleStatus = ServerFaultRule & {
  /** The requests this rule was the first to match. */
  matched: number
  /** The requests it decided, which `everyNth` makes fewer than `matched`. */
  triggered: number
  /** When `forSeconds` removes it, in milliseconds since the epoch. */
  expiresAt?: number
}

/** One server's rules with what each has done, as `get_server_fault_status` answers. */
export interface ServerFaultStatus {
  /** The version of this list, which `set_server_faults` sends back. */
  version: number
  rules: ServerFaultRuleStatus[]
}

/** What `set_server_faults` answers for a payload it accepted. */
export interface ServerFaultWrite {
  /** False when the list had changed since the version sent, and nothing was written. */
  taken: boolean
  /** The list main holds after the write, taken or not. */
  status: ServerFaultStatus
}

/** The rules one server holds now, as `server_faults` carries them on every change. */
export interface ServerFaults {
  uuid: string
  /** The version of this list. */
  version: number
  rules: ServerFaultRule[]
}
