import z from 'zod'
import { FAULT_DELAY_MAX_MS, MAIN_SERVER_UUID, ServerFaultRuleSchema } from '@shared'
import { defineTool, McpTool, McpToolContext, toolError, toolResult } from '../registry'

/** How many rules one server takes. A list is read in order, so a long one is a mistake. */
export const MAX_FAULT_RULES = 32

const UUID_ARGUMENT = z
  .string()
  .min(1)
  .optional()
  .describe('The server, by the uuid server_list answers. Default: the main server')

const unknownServer = (uuid: string): string =>
  `No server has uuid ${uuid}. server_list answers the uuids.`

const targetOf = (uuid: string | undefined, context: McpToolContext): string | undefined => {
  const target = uuid ?? MAIN_SERVER_UUID
  return context.server.hasServer(target) ? target : undefined
}

const serverSetFaults = defineTool({
  name: 'server_set_faults',
  title: 'Set the fault rules of a server',
  description: `Replace the fault rules of a Modbux server, so it answers masters the way a faulty device would. The rules are tried in order for each request, and the first one whose conditions all match the whole request decides it; a condition left out matches everything. Conditions: unitId, registerType (coils, discrete_inputs, input_registers, holding_registers), addressRange [start, end] (PDU addresses, both included; a request touching any of them matches), direction (read or write). action is one of { kind: "exception", code } (answers that Modbus exception code; a write stores nothing), { kind: "no_response" } (answers nothing, as if the device never received it; a write stores nothing), { kind: "delay", ms } (reads and writes as usual and answers ms later, at most ${FAULT_DELAY_MAX_MS}). everyNth: N makes the rule decide only every Nth request it matches; the others are answered as usual and go to no later rule. forSeconds removes the rule that long after it is set. An RTU broadcast (unit 0) stays unanswered whatever the rules say, and an exception or no_response rule stops its write. The rules live in memory only: a restart, deleting the server, or loading a config or project file onto it clears them. server_get_requests shows which rule decided each request, as fault. An empty list clears them. Answers the list now in effect.`,
  inputSchema: {
    uuid: UUID_ARGUMENT,
    rules: z.array(ServerFaultRuleSchema).max(MAX_FAULT_RULES).describe('The whole list, in order')
  },
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: false
  },
  run: async ({ uuid, rules }, context) => {
    const target = targetOf(uuid, context)
    if (!target) return toolError(unknownServer(uuid ?? MAIN_SERVER_UUID))
    return toolResult({ uuid: target, rules: context.server.setFaults(target, rules) })
  }
})

const serverGetFaults = defineTool({
  name: 'server_get_faults',
  title: 'Read the fault rules of a server',
  description:
    'The fault rules a Modbux server holds, in order, each with matched (the requests it was the first rule to match), triggered (the requests it decided, fewer than matched under everyNth) and, for a forSeconds rule, expiresAt (ms since the epoch).',
  inputSchema: { uuid: UUID_ARGUMENT },
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false
  },
  run: async ({ uuid }, context) => {
    const target = targetOf(uuid, context)
    if (!target) return toolError(unknownServer(uuid ?? MAIN_SERVER_UUID))
    return toolResult({ uuid: target, rules: context.server.getFaults(target) })
  }
})

const serverClearFaults = defineTool({
  name: 'server_clear_faults',
  title: 'Clear the fault rules of a server',
  description:
    'Remove every fault rule of a Modbux server, so it answers masters normally again. The user can do the same with the clear button the server view shows while rules are set.',
  inputSchema: { uuid: UUID_ARGUMENT },
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: false
  },
  run: async ({ uuid }, context) => {
    const target = targetOf(uuid, context)
    if (!target) return toolError(unknownServer(uuid ?? MAIN_SERVER_UUID))
    context.server.clearFaults(target)
    return toolResult({ uuid: target, rules: [] })
  }
})

const serverDropConnections = defineTool({
  name: 'server_drop_connections',
  title: 'Drop the connections to a server',
  description:
    'Close every TCP connection a master has open to a Modbux server, the way a device that resets or loses its network does. The server keeps listening, so a master can connect again. Answers how many were closed. A server running on RTU has no connections and answers an error.',
  inputSchema: { uuid: UUID_ARGUMENT },
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: false
  },
  run: async ({ uuid }, context) => {
    const target = targetOf(uuid, context)
    if (!target) return toolError(unknownServer(uuid ?? MAIN_SERVER_UUID))
    const outcome = context.server.dropConnections(target)
    if ('error' in outcome) return toolError(outcome.error)
    return toolResult({ uuid: target, dropped: outcome.dropped })
  }
})

/**
 * The four tools act on Modbux's own simulator rather than on a device, so
 * none is `writesToDevice`. None asks a renderer command, so they answer while
 * the server view is split out.
 */
export const serverFaultTools: readonly McpTool[] = [
  serverSetFaults,
  serverGetFaults,
  serverClearFaults,
  serverDropConnections
]
