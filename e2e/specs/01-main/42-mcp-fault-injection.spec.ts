/**
 * Fault injection, closed loop: a fault rule set over MCP on the main server,
 * the window's client reading that server, and both logs agreeing on the
 * request the rule decided. Then the indicator and its clear button, in the
 * main window and in the split out server window.
 *
 * `server-integration.json` holds registers at unit id 0 of the server on port
 * 502, which is the main server.
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
  navigateToHome,
  navigateToServer,
  selectUnitId,
  splitOutServerWindow
} from '../../fixtures/helpers'
import { evaluateMain } from '../../fixtures/launch'

const SERVER_CONFIG = resolve(__dirname, '../../fixtures/config-files/server-integration.json')
const MCP_URL = 'http://127.0.0.1:15502/mcp'

/** Exception 6 is Server Device Busy, which the server never answers on its own. */
const BUSY = { unitId: 0, action: { kind: 'exception', code: 6 } }

const switchOff = async (p: Page): Promise<void> => {
  await p.evaluate(async () => {
    await window.api.setMcpEnabled(false)
    await window.api.setMcpAllowWrites(false)
  })
}

/** What a tool answered: the error flag and the JSON or text it carried. */
const call = async (
  name: string,
  args: Record<string, unknown> = {}
): Promise<{ isError: boolean; text: string; json: Record<string, unknown> }> => {
  const result = await client.callTool({ name, arguments: args })
  const text = (result.content as { type: string; text: string }[])[0]?.text ?? ''
  let json: Record<string, unknown> = {}
  try {
    json = JSON.parse(text)
  } catch {
    // An error is plain text.
  }
  return { isError: result.isError === true, text, json }
}

let client: Client

/** When the faulted read went out. The main server's log holds earlier specs' requests too. */
let faultedAt = 0

test.beforeAll(async ({ electronApp, mainPage }) => {
  await resetApp(electronApp, mainPage)
  await switchOff(mainPage)
})

test.afterAll(async ({ mainPage }) => {
  await call('server_clear_faults').catch(() => undefined)
  await client?.close().catch(() => undefined)
  await disconnectClient(mainPage).catch(() => undefined)
  await switchOff(mainPage)
})

test.describe.serial('MCP fault injection', () => {
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
    const names = tools.map((tool) => tool.name)
    for (const name of [
      'server_set_faults',
      'server_get_faults',
      'server_clear_faults',
      'server_drop_connections'
    ]) {
      expect(names).toContain(name)
    }
  })

  test('the main server holds registers and no fault rules', async ({ mainPage }) => {
    await cleanServerState(mainPage)
    await loadServerConfig(mainPage, SERVER_CONFIG)
    await expect(mainPage.getByTestId('section-holding_registers')).toContainText('(12)')
    await mainPage.getByTestId('select-server-502').click()
    await selectUnitId(mainPage, '0')
    await expect(mainPage.getByTestId('server-faults-indicator')).toHaveCount(0)
  })

  test('connect the window client to the server, and it reads', async ({ mainPage }) => {
    await navigateToClient(mainPage)
    await connectClient(mainPage, '127.0.0.1', '502', '0')

    expect((await call('client_read_points')).isError).toBe(false)
  })

  test('server_set_faults answers the rule it set', async () => {
    const answer = await call('server_set_faults', { rules: [BUSY] })

    expect(answer.isError).toBe(false)
    expect(answer.json.rules).toEqual([BUSY])
  })

  test('the client read fails with the rule’s exception', async () => {
    faultedAt = Date.now()

    const read = await call('client_read_points')

    expect(read.isError).toBe(true)
    const failed = read.json.failedTransactions as { unitId: number; exceptionCode?: number }[]
    expect(failed[0]).toMatchObject({ unitId: 0, exceptionCode: 6 })
  })

  test('client_get_transactions shows the exception', async () => {
    const answer = await call('client_get_transactions', {
      sinceTimestamp: faultedAt,
      failedOnly: true
    })

    const transactions = answer.json.transactions as { unitId: number; exceptionCode?: number }[]
    expect(transactions.length).toBeGreaterThan(0)
    for (const transaction of transactions) {
      expect(transaction).toMatchObject({ unitId: 0, exceptionCode: 6 })
    }
  })

  test('server_get_requests shows the same request, decided by the rule', async () => {
    const config = await call('client_get_config')
    const { type, address, length } = config.json.registerConfig as {
      type: string
      address: number
      length: number
    }

    const answer = await call('server_get_requests', { sinceTimestamp: faultedAt })

    expect(answer.json.requests).toEqual([
      expect.objectContaining({
        unitId: 0,
        direction: 'read',
        registerType: type,
        address,
        count: length,
        outcome: 'exception',
        exceptionCode: 6,
        fault: { rule: 0 }
      })
    ])
  })

  test('server_get_faults counts the request the rule decided', async () => {
    const answer = await call('server_get_faults')

    expect(answer.json.rules).toEqual([{ ...BUSY, matched: 1, triggered: 1 }])
  })

  test('the server view shows the rule count', async ({ mainPage }) => {
    await navigateToServer(mainPage)

    await expect(mainPage.getByTestId('server-faults-indicator')).toHaveText('1 fault rule')
    await expect(mainPage.getByTestId('server-faults-clear-btn')).toBeVisible()
  })

  test('the clear button removes the rules, and reads come back', async ({ mainPage }) => {
    await mainPage.getByTestId('server-faults-clear-btn').click()

    await expect(mainPage.getByTestId('server-faults-indicator')).toHaveCount(0)
    expect((await call('server_get_faults')).json.rules).toEqual([])
    expect((await call('client_read_points')).isError).toBe(false)
  })

  test('loading a config file onto the server clears its rules', async ({ mainPage }) => {
    await call('server_set_faults', { rules: [BUSY, { action: { kind: 'no_response' } }] })
    await expect(mainPage.getByTestId('server-faults-indicator')).toHaveText('2 fault rules')

    await loadServerConfig(mainPage, SERVER_CONFIG)

    await expect(mainPage.getByTestId('server-faults-indicator')).toHaveCount(0)
    expect((await call('server_get_faults')).json.rules).toEqual([])
  })

  test('the split out server window shows the rules, after a reload too, and clears them', async ({
    electronApp,
    mainPage
  }) => {
    await call('server_set_faults', { rules: [BUSY] })
    await navigateToHome(mainPage)
    const serverPage = await splitOutServerWindow(electronApp, mainPage)

    await expect(serverPage.getByTestId('server-faults-indicator')).toHaveText('1 fault rule')

    // A reloaded window has heard no `server_faults` and asks main instead.
    await serverPage.reload()
    await expect(serverPage.getByTestId('server-faults-indicator')).toHaveText('1 fault rule')

    await serverPage.getByTestId('server-faults-clear-btn').click()
    await expect(serverPage.getByTestId('server-faults-indicator')).toHaveCount(0)
    expect((await call('server_get_faults')).json.rules).toEqual([])

    await evaluateMain(() =>
      electronApp.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()
          .find((w) => w.getTitle() === 'Server')
          ?.close()
      })
    )
    await expect(mainPage.getByTestId('home-btn')).toBeVisible()
  })

  test('server_drop_connections closes the client’s connection', async () => {
    const answer = await call('server_drop_connections')

    expect(answer.isError).toBe(false)
    expect(answer.json.dropped).toBe(1)
  })

  test('disconnect the client', async ({ mainPage }) => {
    await navigateToClient(mainPage)
    await disconnectClient(mainPage).catch(() => undefined)
  })
})
