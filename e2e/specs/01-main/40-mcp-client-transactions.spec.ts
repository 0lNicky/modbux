/**
 * The client's transactions over MCP, against a Modbus server in the same app
 *
 * `server-integration.json` answers for unit id 0 only, so a read of unit id
 * 99 is the case the server refuses with exception 11. The test process is the
 * MCP client: it reads through `client_read_points` and looks at what
 * `client_get_transactions` and the failed result hold.
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
  expectNewestTransactionCell,
  loadServerConfig,
  navigateToClient
} from '../../fixtures/helpers'

const SERVER_CONFIG = resolve(__dirname, '../../fixtures/config-files/server-integration.json')
const MCP_URL = 'http://127.0.0.1:15502/mcp'

const switchOff = async (p: Page): Promise<void> => {
  await p.evaluate(async () => {
    await window.api.setMcpEnabled(false)
    await window.api.setMcpAllowWrites(false)
  })
}

/** What a tool answered: the error flag and the JSON or text it carried. */
const call = async (
  client: Client,
  name: string,
  args: Record<string, unknown>
): Promise<{ isError: boolean; text: string; json: Record<string, unknown> }> => {
  const result = await client.callTool({ name, arguments: args })
  const content = (result.content as { type: string; text: string }[])[0]
  const text = content?.text ?? ''
  let json: Record<string, unknown> = {}
  try {
    json = JSON.parse(text)
  } catch {
    // An error is plain text.
  }
  return { isError: result.isError === true, text, json }
}

let client: Client

test.beforeAll(async ({ electronApp, mainPage }) => {
  await resetApp(electronApp, mainPage)
  await switchOff(mainPage)
})

test.afterAll(async ({ mainPage }) => {
  await client?.close().catch(() => undefined)
  await switchOff(mainPage)
})

test.describe.serial('MCP client transactions', () => {
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
    expect(
      tools.find((tool) => tool.name === 'client_get_transactions')?.annotations?.readOnlyHint
    ).toBe(true)
  })

  test('load the server and connect the client to a unit id it does not have', async ({
    mainPage
  }) => {
    await cleanServerState(mainPage)
    await loadServerConfig(mainPage, SERVER_CONFIG)
    await expect(mainPage.getByTestId('section-holding_registers')).toContainText('(12)')
    await navigateToClient(mainPage)
    await connectClient(mainPage, '127.0.0.1', '502', '99')
  })

  test('client_read_points fails with the exception 11 transaction', async () => {
    const result = await call(client, 'client_read_points', {})

    expect(result.isError).toBe(true)
    const failed = result.json.failedTransactions as {
      unitId: number
      exceptionCode?: number
      responses: string[]
      durationMs?: number
    }[]
    expect(failed.length).toBeGreaterThan(0)
    expect(failed[0]).toMatchObject({ unitId: 99, exceptionCode: 11 })
    // Unit id 99, the function code with its high bit set, the code, then the CRC.
    expect(failed[0]?.responses[0]).toMatch(/^63 83 0B /)
    expect(failed[0]?.durationMs).toBeGreaterThanOrEqual(0)
  })

  test('client_get_transactions answers the same transaction', async () => {
    const result = await call(client, 'client_get_transactions', { failedOnly: true })

    expect(result.isError).toBe(false)
    const transactions = result.json.transactions as { unitId: number; exceptionCode?: number }[]
    expect(transactions.at(-1)).toMatchObject({ unitId: 99, exceptionCode: 11 })
  })

  test('the transaction grid shows the duration column', async ({ mainPage }) => {
    await mainPage.getByTestId('show-log-btn').click()

    await expectNewestTransactionCell(mainPage, 'durationMs', /^\d+$/)

    await mainPage.getByTestId('show-log-btn').click()
  })

  test('a scan attaches no transactions', async () => {
    const result = await call(client, 'client_scan_unit_ids', {
      startUnitId: 98,
      endUnitId: 99,
      timeoutMs: 500
    })

    expect(result.isError).toBe(false)
    expect(result.json).not.toHaveProperty('failedTransactions')
  })

  test('disconnect the client', async ({ mainPage }) => {
    await disconnectClient(mainPage)
  })
})
