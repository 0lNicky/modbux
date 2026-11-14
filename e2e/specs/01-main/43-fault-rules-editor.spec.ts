/**
 * Fault rules edited on screen, closed loop: a rule added in the dialog makes
 * the window's client read fail with its exception, the dialog's counts follow
 * after Refresh, and `server_get_faults` over MCP sees what the screen set.
 * Then edit, move, delete and clear all, and the split out server window.
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
  closeFaultRules,
  connectClient,
  disconnectClient,
  loadServerConfig,
  navigateToClient,
  navigateToHome,
  navigateToServer,
  openFaultRules,
  selectUnitId,
  splitOutServerWindow
} from '../../fixtures/helpers'
import { evaluateMain } from '../../fixtures/launch'

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

/** The exception codes of the failed transactions a `client_read_points` answered. */
const failedCodes = (json: Record<string, unknown>): (number | undefined)[] =>
  (json.failedTransactions as { exceptionCode?: number }[]).map((t) => t.exceptionCode)

/** The rules the server holds, as MCP answers them, without the counts. */
const heldRules = async (): Promise<unknown[]> => {
  const { rules } = (await call('server_get_faults')).json as {
    rules: Record<string, unknown>[]
  }
  const counts = ['matched', 'triggered', 'expiresAt']
  return rules.map((rule) =>
    Object.fromEntries(Object.entries(rule).filter(([key]) => !counts.includes(key)))
  )
}

/** Fill the form's fields. A field not named is left as it is. */
const fillRule = async (
  p: Page,
  fields: {
    unitId?: string
    registerType?: string
    direction?: string
    addressStart?: string
    addressEnd?: string
    action?: 'exception' | 'no-response' | 'delay'
    code?: string
    ms?: string
    everyNth?: string
    forSeconds?: string
  }
): Promise<void> => {
  const text: [string, string | undefined][] = [
    ['fault-form-unit-id', fields.unitId],
    ['fault-form-address-start', fields.addressStart],
    ['fault-form-address-end', fields.addressEnd]
  ]
  for (const [testId, value] of text) {
    if (value !== undefined) await p.getByTestId(testId).fill(value)
  }
  if (fields.registerType !== undefined) {
    await p.getByTestId('fault-form-register-type').click()
    await p.getByRole('option', { name: fields.registerType, exact: true }).click()
  }
  if (fields.direction !== undefined) {
    await p.getByTestId('fault-form-direction').click()
    await p.getByRole('option', { name: fields.direction, exact: true }).click()
  }
  if (fields.action !== undefined) await p.getByTestId(`fault-form-action-${fields.action}`).click()
  const afterAction: [string, string | undefined][] = [
    ['fault-form-code', fields.code],
    ['fault-form-ms', fields.ms],
    ['fault-form-every-nth', fields.everyNth],
    ['fault-form-for-seconds', fields.forSeconds]
  ]
  for (const [testId, value] of afterAction) {
    if (value !== undefined) await p.getByTestId(testId).fill(value)
  }
}

const saveRule = async (p: Page): Promise<void> => {
  await p.getByTestId('fault-form-save-btn').click()
  await expect(p.getByTestId('fault-form-save-btn')).toHaveCount(0)
}

let client: Client

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

test.describe.serial('fault rules editor', () => {
  test('enable MCP, load the server, and connect the window client', async ({ mainPage }) => {
    const status = await mainPage.evaluate(() => window.api.setMcpEnabled(true))
    expect(status.state).toBe('running')
    client = new Client({ name: 'e2e', version: '0' })
    await client.connect(
      new StreamableHTTPClientTransport(new URL(MCP_URL), {
        requestInit: { headers: { Authorization: `Bearer ${status.token}` } }
      })
    )

    await cleanServerState(mainPage)
    await loadServerConfig(mainPage, SERVER_CONFIG)
    await navigateToClient(mainPage)
    await connectClient(mainPage, '127.0.0.1', '502', '0')

    expect((await call('client_read_points')).isError).toBe(false)
  })

  test('the dialog of a server with no rules says so and offers no clear all', async ({
    mainPage
  }) => {
    await navigateToServer(mainPage)
    await mainPage.getByTestId('select-server-502').click()
    await selectUnitId(mainPage, '0')

    await openFaultRules(mainPage)

    await expect(mainPage.getByTestId('server-faults-empty')).toBeVisible()
    await expect(mainPage.getByTestId('server-faults-clear-all-btn')).toBeDisabled()
  })

  test('the form refuses a rule that is not whole, and says where', async ({ mainPage }) => {
    await mainPage.getByTestId('server-faults-add-btn').click()

    await expect(mainPage.getByTestId('fault-form-save-btn')).toBeDisabled()
    await fillRule(mainPage, { code: '300' })
    await expect(mainPage.getByTestId('fault-form-save-btn')).toBeDisabled()
    await fillRule(mainPage, { code: '6', addressStart: '5' })
    await expect(mainPage.getByText('Needs both ends')).toBeVisible()
    await expect(mainPage.getByTestId('fault-form-save-btn')).toBeDisabled()
    await mainPage.getByTestId('fault-form-cancel-btn').click()

    expect(await heldRules()).toEqual([])
  })

  test('an exception rule added on screen is the rule the client meets', async ({ mainPage }) => {
    await mainPage.getByTestId('server-faults-add-btn').click()
    await fillRule(mainPage, { unitId: '0', action: 'exception', code: '6' })
    await saveRule(mainPage)

    await expect(mainPage.getByTestId('server-faults-rule-0-summary')).toHaveText(
      'unit 0: exception 6'
    )
    await expect(mainPage.getByTestId('server-faults-indicator')).toHaveText('1 fault rule')
    expect(await heldRules()).toEqual([{ unitId: 0, action: { kind: 'exception', code: 6 } }])

    const read = await call('client_read_points')
    expect(read.isError).toBe(true)
    expect(failedCodes(read.json)[0]).toBe(6)
  })

  test('the counts stay until Refresh, and then show the request the rule decided', async ({
    mainPage
  }) => {
    await expect(mainPage.getByTestId('server-faults-rule-0-counts')).toHaveText(
      'triggered 0 / matched 0'
    )

    await mainPage.getByTestId('server-faults-refresh-btn').click()

    await expect(mainPage.getByTestId('server-faults-rule-0-counts')).toHaveText(
      'triggered 1 / matched 1'
    )
  })

  test('adding a rule starts every count over, as the dialog says', async ({ mainPage }) => {
    await expect(mainPage.getByTestId('server-faults-dialog')).toContainText(
      'Every change replaces the whole list'
    )

    await mainPage.getByTestId('server-faults-add-btn').click()
    await fillRule(mainPage, {
      registerType: 'coils',
      direction: 'Write',
      addressStart: '0',
      addressEnd: '9',
      action: 'no-response',
      everyNth: '2',
      forSeconds: '3600'
    })
    await saveRule(mainPage)

    await expect(mainPage.getByTestId('server-faults-rule-1-summary')).toHaveText(
      'coils, addresses 0-9, writes: no response, every 2nd match, 3600 s'
    )
    await expect(mainPage.getByTestId('server-faults-rule-1-left')).toHaveText(/^\d+ s left$/)
    await expect(mainPage.getByTestId('server-faults-rule-0-counts')).toHaveText(
      'triggered 0 / matched 0'
    )
    expect(await heldRules()).toEqual([
      { unitId: 0, action: { kind: 'exception', code: 6 } },
      {
        registerType: 'coils',
        direction: 'write',
        addressRange: [0, 9],
        action: { kind: 'no_response' },
        everyNth: 2,
        forSeconds: 3600
      }
    ])
  })

  test('move up and down reorder the rules main holds', async ({ mainPage }) => {
    await expect(mainPage.getByTestId('server-faults-rule-0-up')).toBeDisabled()
    await expect(mainPage.getByTestId('server-faults-rule-1-down')).toBeDisabled()

    await mainPage.getByTestId('server-faults-rule-1-up').click()

    await expect(mainPage.getByTestId('server-faults-rule-0-summary')).toContainText('coils')
    await expect(mainPage.getByTestId('server-faults-rule-1-summary')).toHaveText(
      'unit 0: exception 6'
    )
    expect((await heldRules())[0]).toMatchObject({ registerType: 'coils' })

    await mainPage.getByTestId('server-faults-rule-0-down').click()

    await expect(mainPage.getByTestId('server-faults-rule-0-summary')).toHaveText(
      'unit 0: exception 6'
    )
    expect((await heldRules())[0]).toMatchObject({ unitId: 0 })
  })

  test('edit opens the rule’s fields and a new code is what the client meets', async ({
    mainPage
  }) => {
    await mainPage.getByTestId('server-faults-rule-0-edit').click()
    await expect(mainPage.getByTestId('fault-form-unit-id')).toHaveValue('0')
    await expect(mainPage.getByTestId('fault-form-code')).toHaveValue('6')

    await fillRule(mainPage, { code: '2' })
    await saveRule(mainPage)

    await expect(mainPage.getByTestId('server-faults-rule-0-summary')).toHaveText(
      'unit 0: exception 2'
    )
    expect((await heldRules())[0]).toEqual({ unitId: 0, action: { kind: 'exception', code: 2 } })
    expect(failedCodes((await call('client_read_points')).json)[0]).toBe(2)
  })

  test('delete removes the rule it names, and the client reads again', async ({ mainPage }) => {
    await mainPage.getByTestId('server-faults-rule-0-delete').click()

    await expect(mainPage.getByTestId('server-faults-rule-0-summary')).toContainText('coils')
    await expect(mainPage.getByTestId('server-faults-rule-1')).toHaveCount(0)
    expect(await heldRules()).toHaveLength(1)
    expect((await call('client_read_points')).isError).toBe(false)
  })

  test('clear all empties the list, and the indicator goes back to its idle label', async ({
    mainPage
  }) => {
    await mainPage.getByTestId('server-faults-clear-all-btn').click()

    await expect(mainPage.getByTestId('server-faults-empty')).toBeVisible()
    expect(await heldRules()).toEqual([])
    await closeFaultRules(mainPage)
    await expect(mainPage.getByTestId('server-faults-indicator')).toHaveText('Fault rules')
  })

  test('main refuses a window’s write built from the list MCP has since replaced', async ({
    mainPage
  }) => {
    const uuid = String((await call('server_get_faults')).json.uuid)
    const read = await mainPage.evaluate((id) => window.api.getServerFaultStatus(id), uuid)
    const MCP_RULES = [{ unitId: 0, action: { kind: 'exception', code: 4 } }]
    await call('server_set_faults', { rules: MCP_RULES })

    const answer = await mainPage.evaluate(
      ({ id, version }) => window.api.setServerFaults({ uuid: id, version, rules: [] }),
      { id: uuid, version: read.version }
    )

    expect(answer?.taken).toBe(false)
    expect(answer?.status.version).not.toBe(read.version)
    expect(await heldRules()).toEqual(MCP_RULES)

    // The version main answered is the one it takes.
    const taken = await mainPage.evaluate(
      ({ id, version }) => window.api.setServerFaults({ uuid: id, version, rules: [] }),
      { id: uuid, version: answer?.status.version ?? -1 }
    )
    expect(taken?.taken).toBe(true)
    expect(await heldRules()).toEqual([])
  })

  test('a rule set over MCP shows in the dialog, and Refresh reads its counts', async ({
    mainPage
  }) => {
    await call('server_set_faults', {
      rules: [{ unitId: 0, action: { kind: 'delay', ms: 100 } }]
    })
    await expect(mainPage.getByTestId('server-faults-indicator')).toHaveText('1 fault rule')

    await openFaultRules(mainPage)

    await expect(mainPage.getByTestId('server-faults-rule-0-summary')).toHaveText(
      'unit 0: delay 100 ms'
    )
    await closeFaultRules(mainPage)
  })

  test('the split out server window edits the same list', async ({ electronApp, mainPage }) => {
    await navigateToHome(mainPage)
    const serverPage = await splitOutServerWindow(electronApp, mainPage)
    await expect(serverPage.getByTestId('server-faults-indicator')).toHaveText('1 fault rule')

    await openFaultRules(serverPage)
    await expect(serverPage.getByTestId('server-faults-rule-0-summary')).toHaveText(
      'unit 0: delay 100 ms'
    )
    await serverPage.getByTestId('server-faults-add-btn').click()
    await fillRule(serverPage, { action: 'no-response' })
    await saveRule(serverPage)

    await expect(serverPage.getByTestId('server-faults-rule-1-summary')).toHaveText(
      'every request: no response'
    )
    expect(await heldRules()).toEqual([
      { unitId: 0, action: { kind: 'delay', ms: 100 } },
      { action: { kind: 'no_response' } }
    ])

    // A reloaded window asks main again, and clear all works from there too.
    await serverPage.reload()
    await expect(serverPage.getByTestId('server-faults-indicator')).toHaveText('2 fault rules')
    await openFaultRules(serverPage)
    await serverPage.getByTestId('server-faults-clear-all-btn').click()
    await expect(serverPage.getByTestId('server-faults-empty')).toBeVisible()
    expect(await heldRules()).toEqual([])

    await evaluateMain(() =>
      electronApp.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()
          .find((w) => w.getTitle() === 'Server')
          ?.close()
      })
    )
    await expect(mainPage.getByTestId('home-btn')).toBeVisible()
  })

  test('disconnect the client', async ({ mainPage }) => {
    await navigateToClient(mainPage)
    await disconnectClient(mainPage).catch(() => undefined)
  })
})
