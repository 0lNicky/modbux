import { test, expect, resetApp } from '../../fixtures/electron-app'
import {
  selectDataType,
  selectRegisterType,
  cell,
  expectCell,
  readRegisters,
  clearData,
  connectClient,
  disconnectClient,
  navigateToServer,
  navigateToClient,
  cleanServerState
} from '../../fixtures/helpers'

test.beforeAll(async ({ electronApp, mainPage }) => {
  await resetApp(electronApp, mainPage)
})

/** Assert a holding register's hex cell reaches `hex` within a few ramp steps. */
const expectRampReaches = async (
  page: Parameters<typeof expectCell>[0],
  hex: string
): Promise<void> => {
  await expect(async () => {
    await expectCell(page, 0, 'hex', hex)
  }).toPass({ timeout: 10000 })
}

test.describe.serial('Ramp generator', () => {
  test('clean server state', async ({ mainPage }) => {
    await cleanServerState(mainPage)
  })

  test('add a uint16 ramp: start 5, step 1, min 0, max 7, interval 1', async ({ mainPage }) => {
    await mainPage.getByTestId('add-holding_registers-btn').click()
    const addressField = mainPage.getByTestId('add-reg-address-input')
    await expect(addressField).toBeVisible()

    await selectDataType(mainPage, 'UINT16')
    await addressField.locator('input').fill('0')
    await mainPage.getByTestId('add-reg-ramp-btn').click()

    const startInput = mainPage.getByTestId('add-reg-start-input').locator('input')
    await expect(startInput).toBeVisible()
    await startInput.fill('5')
    await mainPage.getByTestId('add-reg-step-input').locator('input').fill('1')
    await mainPage.getByTestId('add-reg-min-input').locator('input').fill('0')
    await mainPage.getByTestId('add-reg-max-input').locator('input').fill('7')
    await mainPage.getByTestId('add-reg-interval-input').locator('input').fill('1')
    await expect(mainPage.getByTestId('add-reg-restart-checkbox').locator('input')).toBeChecked()

    await mainPage.getByTestId('add-reg-submit-btn').click()
    await expect(addressField).not.toBeVisible()
    await expect(mainPage.getByTestId('section-holding_registers')).toContainText('(1)')
  })

  test('the client reads it climb to max and return to start', async ({ mainPage }) => {
    await navigateToClient(mainPage)
    await connectClient(mainPage, '127.0.0.1', '502', '0')
    await selectRegisterType(mainPage, 'Holding Registers')
    await readRegisters(mainPage, '0', '1')

    await mainPage.getByTestId('poll-btn').click()
    await expectRampReaches(mainPage, '0007')
    await expectRampReaches(mainPage, '0005')
    await mainPage.getByTestId('poll-btn').click()
  })

  test('editing opens the dialog in ramp mode with its fields', async ({ mainPage }) => {
    await navigateToServer(mainPage)
    await mainPage.getByTestId('server-edit-reg-holding_registers-0').click()

    await expect(mainPage.getByTestId('add-reg-ramp-btn')).toHaveClass(/Mui-selected/)
    await expect(mainPage.getByTestId('add-reg-start-input').locator('input')).toHaveValue('5')
    await expect(mainPage.getByTestId('add-reg-step-input').locator('input')).toHaveValue('1')
    await expect(mainPage.getByTestId('add-reg-min-input').locator('input')).toHaveValue('0')
    await expect(mainPage.getByTestId('add-reg-max-input').locator('input')).toHaveValue('7')

    const restart = mainPage.getByTestId('add-reg-restart-checkbox').locator('input')
    await expect(restart).toBeChecked()
    await restart.click()
    await expect(restart).not.toBeChecked()

    await mainPage.getByTestId('add-reg-submit-btn').click()
    await expect(mainPage.getByTestId('add-reg-address-input')).not.toBeVisible()
  })

  test('with restart off, the client reads it hold at max', async ({ mainPage }) => {
    await navigateToClient(mainPage)
    await mainPage.getByTestId('poll-btn').click()
    await expectRampReaches(mainPage, '0007')

    // A restarting ramp would read 0005 or 0006 within the next two intervals.
    // Each sample is a deliberate point-in-time read of a later poll.
    for (let sample = 0; sample < 4; sample++) {
      await mainPage.waitForTimeout(600)
      expect(await cell(mainPage, 0, 'hex')).toBe('0007')
    }

    await mainPage.getByTestId('poll-btn').click()
    await clearData(mainPage)
  })

  test('disconnect the client', async ({ mainPage }) => {
    await disconnectClient(mainPage)
  })
})
