import z from 'zod'
import { MAIN_SERVER_UUID } from '@shared'
import { SERVER_REQUEST_LOG_LIMIT } from '../../modbusServer/requestLog'
import { defineTool, McpTool, toolResult } from '../registry'

/**
 * What masters asked the Modbux servers, read from main's request log.
 *
 * It asks no renderer command, so it answers while the server view is split
 * out, when `server_list` is refused.
 */
const serverGetRequests = defineTool({
  name: 'server_get_requests',
  title: 'Read the requests a server answered',
  description: `The requests Modbus masters sent a Modbux server, oldest first: one entry per request, whatever its count. Each has timestamp (ms since the epoch), uuid, unitId, direction (read or write), registerType, address (the first, as a PDU address), count, outcome (ok, exception with exceptionCode, or no_response), the values a write carried, and fault when a fault rule decided it. The server keeps its newest ${SERVER_REQUEST_LOG_LIMIT} in memory, forgets them when it is deleted, and never saves them. On RTU, unit 0 is broadcast: a read of it gets no response, and a write to it is written to every hosted unit, gets no response, and is recorded ok, unless it runs past address 65535: then nothing is written and it is recorded no_response. An unknown uuid answers no requests.`,
  inputSchema: {
    uuid: z
      .string()
      .min(1)
      .optional()
      .describe('The server, by the uuid server_list answers. Default: the main server'),
    limit: z
      .number()
      .int()
      .min(1)
      .max(SERVER_REQUEST_LOG_LIMIT)
      .default(50)
      .describe('The newest this many, after the other filters'),
    sinceTimestamp: z
      .number()
      .int()
      .nonnegative()
      .optional()
      .describe('Only requests at or after this time, in ms since the epoch'),
    failedOnly: z
      .boolean()
      .default(false)
      .describe('Only requests answered with an exception or not answered')
  },
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false
  },
  run: async ({ uuid, limit, sinceTimestamp, failedOnly }, context) => {
    const target = uuid ?? MAIN_SERVER_UUID
    const requests = context.server.getRequests(target, { limit, sinceTimestamp, failedOnly })
    return toolResult({ uuid: target, requests })
  }
})

export const serverRequestTools: readonly McpTool[] = [serverGetRequests]
