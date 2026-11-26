import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { GetPromptResult } from '@modelcontextprotocol/sdk/types.js'
import z from 'zod'
import { ENCODING_RESOURCE_URI } from './resources'

/**
 * The prompts: workflows an agent follows with the tools. Three start from a
 * point table and one from a device fault to simulate.
 *
 * A prompt is text the client hands to the model, so each one names the tools
 * in the order to call them, and the check that tells the agent it is done.
 */

const POINT_TABLE_ARGUMENT = {
  pointTable: z
    .string()
    .min(1)
    .describe(
      'The point table as text: pasted rows from a datasheet, a CSV, or a Markdown table. Each point has an address, a data type and usually a scaling factor, unit and comment.'
    )
}

const userMessage = (text: string): GetPromptResult => ({
  messages: [{ role: 'user', content: { type: 'text', text } }]
})

const tableBlock = (pointTable: string): string => `Point table:\n\n\`\`\`\n${pointTable}\n\`\`\``

const ENCODING_STEP = `Read the resource ${ENCODING_RESOURCE_URI} first: it gives the data type widths, the four byte orders and how a table's address notation (0-based, 1-based, Modicon) maps to the PDU address that every Modbux tool takes.`

/** How a point table becomes the \`points\` argument of the two apply tools. */
const POINTS_ARGUMENT = `The apply tools take the table as \`points\`, one object per point: \`name\`, \`address\`, \`registerType\` (coils, discrete_inputs, input_registers, holding_registers; implied by a modicon address), \`dataType\` (omitted for coils and discrete inputs), and where the table gives them \`scalingFactor\`, \`interpolate\`, \`unit\`, \`comment\` and \`byteOrder\`. Pass the table's address notation once as \`notation\` (pdu0, one_based or modicon) and its byte order once as \`byteOrder\`; one configuration holds one byte order.`

/** Load the point table into the client and check it against the device. */
export const pointTableToClientPrompt = (pointTable: string): GetPromptResult =>
  userMessage(`Load this point table into the Modbux client and check it reads correctly from the device.

${ENCODING_STEP}

${tableBlock(pointTable)}

Steps:

1. Call client_get_config to see the connection, the register config and the mapping the client holds now.
2. If the connection is not the device's, call client_set_connection with the host and port (TCP) or the serial settings (RTU) and the unit id. Ask the user for what the table does not say. If the client is connected to another device, call client_disconnect first.
3. Call client_apply_point_table with dryRun: true. ${POINTS_ARGUMENT} The answer lists every point as accepted or rejected, with the reason for each rejected point. Fix the rejected points (address notation, data type, scaling, a type that does not fit the register type) and repeat the dry run until nothing is rejected. A point you cannot fix from the table, ask the user about; do not guess.
4. Call client_apply_point_table again without dryRun to load the points into the client.
5. Call client_connect, then client_read_points.
6. Check every point for plausibility: a temperature near room temperature, a voltage near the mains, a frequency near 50 or 60, a counter that is not negative, a scaling that leaves a sensible number of decimals. Compare with any expected value or range in the table.
7. When a value is implausible (huge, tiny, NaN, or digits that look swapped), the word order is the first suspect for 32-bit and 64-bit types. Read ${ENCODING_RESOURCE_URI} for the four byte orders ABCD, CDAB, BADC and DCBA, call client_apply_point_table again with that order as \`byteOrder\` (and no \`byteOrder\` on the points, which would contradict it), and call client_read_points again. Keep the order whose values are plausible for every multi-register point. Check the scaling the same way: a value off by a power of ten means the scaling factor.
8. Report: the byte order you settled on, each point with its value, and every point that stayed implausible with your best explanation. Call client_disconnect only if the user asked for it.

Reads are always allowed. Do not call client_write unless the user asks for a write.`)

/** Build a simulator from the point table. */
export const pointTableToSimulatorPrompt = (pointTable: string): GetPromptResult =>
  userMessage(`Build a Modbus simulator in Modbux from this point table, so the user can test a client against it.

${ENCODING_STEP}

${tableBlock(pointTable)}

Steps:

1. Call server_list to see the servers that exist. Reuse one only if the user says so; otherwise call server_create for a new server, with the unit id and port the user wants.
2. Call server_apply_point_table with dryRun: true on that server, naming it by \`uuid\` or \`port\` and the unit by \`unitId\`. ${POINTS_ARGUMENT} The answer lists every point as accepted or rejected, with the reason for each rejected point. Fix the rejected points and repeat the dry run until nothing is rejected.
3. Choose a value for each point, and apply with server_apply_point_table without dryRun. Give a point a fixed value (\`value\`) when the table has a default, a constant or a status, a generator range (\`generator: { min, max, intervalSeconds }\`, so the value moves) for a measurement such as a temperature, a power or a voltage, and a ramp (\`generator: { mode: 'ramp', start, step, min, max, intervalSeconds, restart }\`, which adds a signed step every interval and returns to start past min or max, or holds when restart is false) for a quantity that accumulates or drains steadily, such as energy. Take the range from the table, or from what the physical quantity plausibly does. Values are engineering values; the tool applies the scaling and the byte order.
4. Call server_get_values to read back what the server holds, and check a few points against what you meant (a scaled value, a 32-bit value across its two registers).
5. Report: the server's port and unit id, the number of points applied, and which points have a fixed value and which a generator.

If the table gives no unit id or port, say which you chose. server_set_values changes values afterwards.`)

/** Build the simulator, point the client at it, and compare every point. */
export const closedLoopTestPrompt = (pointTable: string): GetPromptResult =>
  userMessage(`Run a closed-loop test of this point table: build a simulator from it, read it back through the Modbux client, and compare. A mismatch means the table is read differently by the two sides: the data type, the byte order, the scaling or the address notation.

${ENCODING_STEP}

${tableBlock(pointTable)}

Steps:

1. Call server_list. Call server_create for a new server for this test, and note its port.
2. Call server_apply_point_table with dryRun: true on it (by \`port\`), fix every rejected point, then apply it without dryRun with a fixed \`value\` for every point. ${POINTS_ARGUMENT} Choose values that expose mistakes: not 0, not 1, a different value per point, a fraction where the scaling allows, and for a 32-bit or 64-bit type a value whose words differ so a swapped word order shows.
3. Call client_get_config. Call client_set_connection with \`protocol: "ModbusTcp"\`, \`tcp: { host: "127.0.0.1", options: { port } }\` with the port of that server, and \`unitId\` the server's unit id. Call client_disconnect first if the client is connected elsewhere.
4. Call client_apply_point_table with dryRun: true and the same table, fix rejected points, then apply it without dryRun.
5. Call client_connect, then client_read_points.
6. Call server_get_values, and compare every point: the value client_read_points answers against the value you gave the server. A float within rounding counts as equal; anything else does not.
7. Report one line per point (address, data type, expected, read, equal or not), then the mismatches with your best cause for each. When several 32-bit points mismatch the same way, try another byte order from ${ENCODING_RESOURCE_URI} as \`byteOrder\` on both server_apply_point_table and client_apply_point_table and test again; say which order the table needs.
8. Clean up: call client_disconnect and, if you created the server for this test and the user does not want to keep it, server_delete.

The client and the server are the same program, so a pass shows the two sides agree with each other. It does not show that the table matches a real device.`)

const SITUATION_ARGUMENT = {
  situation: z
    .string()
    .min(1)
    .describe(
      'The device fault to simulate, in words: offline, busy, slow, a dropped connection, a frozen or invalid value, a counter rolling over, or anything else a field device does.'
    )
}

/** Make a Modbux server misbehave the way a faulty device would. */
export const simulateDeviceFaultPrompt = (situation: string): GetPromptResult =>
  userMessage(`Make a Modbux server behave like a device with this fault, so the user can see what their master (SCADA, PLC, gateway) does about it.

Situation: ${situation}

Steps:

1. Call server_list and pick the server the master polls; ask the user if it is not clear. Call server_get_values on it to see the units and registers it holds, and server_get_requests to see what the master is asking (unit id, register type, addresses, how often).
2. Build the fault from the pieces below. A fault in how the device answers is a rule for server_set_faults; a fault in what it answers is a value for server_set_values. Use the unit id, register type and addresses from step 1 so the rule matches what the master really asks.
3. Apply it. For a value, call server_get_values to confirm what the server now holds. Then call server_get_requests with sinceTimestamp set to when you applied it, and check that the master's requests carry a fault naming your rule (or, for a value, that the master read the right unit and range and the read succeeded). A read record carries no values, so what the master received shows in the master's own result or in a second read of the value. server_get_faults answers how often each rule matched and fired. A rule that never fires means its conditions do not match what the master asks: compare them with the requests. A request modbus-serial answers by itself, such as a quantity of 0, is in neither list.
4. Tell the user what you set, what the requests show, and how to stop it.

Rules (server_set_faults replaces the whole list; the first rule that matches a request decides it, so put the narrow rules first):

- Offline: \`{ unitId, action: { kind: "no_response" } }\`. The device answers nothing, as if it were unplugged, and a write stores nothing.
- Busy: \`{ unitId, action: { kind: "exception", code: 6 } }\` (6 is Server Device Busy). Add \`everyNth: 3\` for a device that is busy now and then.
- Refusing writes: \`{ direction: "write", action: { kind: "exception", code: 1 } }\` (illegal function), or code 2 for an address the device does not have.
- Slow: \`{ action: { kind: "delay", ms } }\`. Values are read and written as usual and the answer comes ms later; set ms above the master's timeout to make it time out.
- A fault for a while: add \`forSeconds\` to any rule, and it removes itself.
- A dropped connection: call server_drop_connections. The server keeps listening and the master can reconnect. For an outage, set a no_response rule with forSeconds first, then drop the connections. RTU has no connections to drop; use no_response there.

Values (server_set_values writes engineering values into registers the server already holds; a register a generator drives is refused, so replace that point with a fixed value through server_apply_point_table first, which replaces every register of the unit it names, so give it every point):

- A frozen value: a fixed value in place of a generator, and leave it.
- An invalid-value sentinel: 65535 (0xFFFF) on a uint16, -32768 (0x8000) on an int16. A float NaN cannot be sent as JSON: make the same address two uint16 points holding the words of a NaN (0x7FC0 and 0x0000 for a float32 in ABCD order; swap them for CDAB) with server_apply_point_table.
- Out of range: a value outside the range the point table gives but inside its data type, such as 9999 on a temperature.
- A counter rolling over: set the counter near the top of its type (4294967290 on a uint32), then to a small value.

Stop it with server_clear_faults, and server_set_values or server_apply_point_table for the values. The user can also clear the rules with the button the server view shows while any are set. Rules live in memory only: a restart, deleting the server, or loading a config or project file onto it clears them.`)

/** Put the four prompts on `server`. */
export const registerPrompts = (server: McpServer): void => {
  server.registerPrompt(
    'point_table_to_client',
    {
      title: 'Point table to client',
      description:
        'Load a point table into the Modbux client, connect, read the points, and check word order and scaling by plausibility.',
      argsSchema: POINT_TABLE_ARGUMENT
    },
    ({ pointTable }) => pointTableToClientPrompt(pointTable)
  )
  server.registerPrompt(
    'point_table_to_simulator',
    {
      title: 'Point table to simulator',
      description:
        'Create a Modbux server from a point table, with fixed values or generator ranges, so a client can be tested against it.',
      argsSchema: POINT_TABLE_ARGUMENT
    },
    ({ pointTable }) => pointTableToSimulatorPrompt(pointTable)
  )
  server.registerPrompt(
    'closed_loop_test',
    {
      title: 'Closed-loop test',
      description:
        'Build a simulator from a point table, point the Modbux client at it, read every point and compare with what the server holds.',
      argsSchema: POINT_TABLE_ARGUMENT
    },
    ({ pointTable }) => closedLoopTestPrompt(pointTable)
  )
  server.registerPrompt(
    'simulate_device_fault',
    {
      title: 'Simulate a device fault',
      description:
        'Make a Modbux server act like a faulty device: offline, busy, slow, dropping connections, or answering frozen or invalid values, and check from its request log that the fault fired.',
      argsSchema: SITUATION_ARGUMENT
    },
    ({ situation }) => simulateDeviceFaultPrompt(situation)
  )
}
