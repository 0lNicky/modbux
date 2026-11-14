/**
 * server_get_requests against a Modbus server in the same app
 *
 * `server-integration.json` holds registers at unit id 0 of the server on port
 * 502, which is the main server. The window's client reads it once through
 * `client_read_points`, and the server's request log answers that read as one
 * request.
 */
import { test, expect, resetApp } from '../../fixtures/electron-app'
import type { Page } from '@playwright/test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { resolve } from 'path'
import {
  cleanServerState,
  connectClient,
  disconnectClient,
  loadServerConfig,
  navigateToClient,
  selectUnitId
} from '../../fixtures/helpers'

const SERVER_CONFIG = resolve(__dirname, '../../fixtures/config-files/server-integration.json')
const MCP_URL = 'http://127.0.0.1:15502/mcp'

const switchOff = async (p: Page): Promise<void> => {
  await p.evaluate(async () => {
    await window.api.setMcpEnabled(false)
    await window.api.setMcpAllowWrites(false)
  })
}

/** The JSON a tool answered, or a failure saying the tool refused. */
const callJson = async (
  name: string,
  args: Record<string, unknown> = {}
): Promise<Record<string, unknown>> => {
  const result = await client.callTool({ name, arguments: args })
  const text = (result.content as { type: string; text: string }[])[0]?.text ?? ''
  if (result.isError) throw new Error(`${name} refused: ${text}`)
  return JSON.parse(text)
}

let client: Client

/**
 * When the read went out. The main server outlives every spec, so its log holds
 * what earlier specs asked it too.
 */
let readAt = 0

test.beforeAll(async ({ electronApp, mainPage }) => {
  await resetApp(electronApp, mainPage)
  await switchOff(mainPage)
})

test.afterAll(async ({ mainPage }) => {
  await client?.close().catch(() => undefined)
  await disconnectClient(mainPage).catch(() => undefined)
  await switchOff(mainPage)
})

test.describe.serial('MCP server request log', () => {
  test('enable MCP and connect an MCP client', async ({ mainPage }) => {
    const status = await mainPage.evaluate(() => window.api.setMcpEnabled(true))
    expect(status.state).toBe('running')

    client = new Client({ name: 'e2e', version: '0' })
    await client.connect(
      new StreamableHTTPClientTransport(new URL(MCP_URL), {
        requestInit: { headers: { Authorization: `Bearer ${status.token}` } }
      })
    )
    const { tools } = await client.listTools()
    expect(tools.find((tool) => tool.name === 'server_get_requests')?.annotations).toMatchObject({
      readOnlyHint: true
    })
  })

  test('the main server holds registers', async ({ mainPage }) => {
    await cleanServerState(mainPage)
    await loadServerConfig(mainPage, SERVER_CONFIG)
    await expect(mainPage.getByTestId('section-holding_registers')).toContainText('(12)')
    await mainPage.getByTestId('select-server-502').click()
    await selectUnitId(mainPage, '0')
  })

  test('connect the window client to the server', async ({ mainPage }) => {
    await navigateToClient(mainPage)
    await connectClient(mainPage, '127.0.0.1', '502', '0')
  })

  test('server_get_requests answers the read the client sent', async () => {
    const config = await callJson('client_get_config')
    const { type, address, length } = config.registerConfig as {
      type: string
      address: number
      length: number
    }
    readAt = Date.now()

    await callJson('client_read_points')
    const answer = await callJson('server_get_requests', { sinceTimestamp: readAt })

    expect(answer.requests).toEqual([
      expect.objectContaining({
        unitId: 0,
        direction: 'read',
        registerType: type,
        address,
        count: length,
        outcome: 'ok'
      })
    ])
  })

  test('failedOnly leaves the answered read out', async () => {
    const answer = await callJson('server_get_requests', {
      sinceTimestamp: readAt,
      failedOnly: true
    })

    expect(answer.requests).toEqual([])
  })
})
