// @vitest-environment happy-dom
/// <reference types="@testing-library/jest-dom/vitest" />
import { act, render, screen, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { RegisterParamsSchema, type ServerRegister } from '@shared'

// ─── Store stub ──────────────────────────────────────────────────────
// The real server store persists through window.api on import, which is far
// more machinery than the dialog's buttons need.

const mockRemoveRegister = vi.fn()
const serverState = {
  selectedUuid: 'main',
  getUnitId: (): string => '0',
  servers: {
    main: {
      usedAddresses: { '0': { holding_registers: [100, 101] } },
      registers: {},
      littleEndian: false
    }
  },
  removeRegister: mockRemoveRegister,
  // The real action answers whether main took the register, and everything the
  // buttons do after a submit is behind that answer.
  addRegister: vi.fn((): Promise<boolean> => Promise.resolve(true))
}

vi.mock('@renderer/context/server.zustand', () => ({
  useServerZustand: Object.assign(
    (selector: (state: typeof serverState) => unknown) => selector(serverState),
    { getState: () => serverState }
  )
}))

import AddRegister from '../AddRegister'
import { useAddRegisterZustand } from '../addRegister.zustand'

const registerAt100: ServerRegister[number] = {
  value: 0,
  params: {
    address: 100,
    registerType: 'holding_registers',
    dataType: 'uint32',
    comment: 'flow rate',
    value: 7,
    min: undefined,
    max: undefined,
    interval: undefined
  }
}

/** The same address as a generator, which carries a range instead of a value. */
const generatorAt100: ServerRegister[number] = {
  value: 0,
  params: {
    address: 100,
    registerType: 'holding_registers',
    dataType: 'uint32',
    comment: 'flow rate',
    value: undefined,
    min: 0,
    max: 500,
    interval: 5000
  }
}

/** A timestamp the store folds as milliseconds and stores as seconds for unix. */
const JUNE_2024_MS = Date.UTC(2024, 5, 1, 12, 34, 56, 789)

const timestampAt100 = (dataType: 'unix' | 'datetime', value: number): ServerRegister[number] => ({
  value: 0,
  params: {
    address: 100,
    registerType: 'holding_registers',
    dataType,
    comment: 'stamp',
    value,
    min: undefined,
    max: undefined,
    interval: undefined
  }
})

const datetimeAt100 = timestampAt100('datetime', JUNE_2024_MS)
const unixAt100 = timestampAt100('unix', Math.floor(JUNE_2024_MS / 1000))

/** A timestamp register that generates, which carries an interval and no value. */
const timestampGeneratorAt100 = (dataType: 'unix' | 'datetime'): ServerRegister[number] => ({
  value: 0,
  params: {
    address: 100,
    registerType: 'holding_registers',
    dataType,
    comment: 'stamp',
    value: undefined,
    min: 0,
    max: 0,
    interval: 5000
  }
})

/** A bitmap the dialog has no generator controls for, which a config file can still hold. */
const bitmapGeneratorAt100: ServerRegister[number] = {
  value: 0,
  params: {
    address: 100,
    registerType: 'holding_registers',
    dataType: 'bitmap',
    comment: 'status',
    value: undefined,
    min: 0,
    max: 65535,
    interval: 5000
  }
}

const submitButton = (): HTMLElement => screen.getByTestId('add-reg-submit-btn')
const removeButton = (): HTMLElement => screen.getByTestId('add-reg-remove-btn')

/** The attribute sits on the MUI field, and what a user types into is inside it. */
const fieldInput = (testId: string): HTMLElement =>
  within(screen.getByTestId(testId)).getByRole('textbox')

/**
 * The picker's sections, which is what a user types a date into.
 *
 * The testid is on the input beside them, which the accessible field structure
 * marks `aria-hidden` and leaves out of the tab order.
 */
const datetimeSections = (): HTMLElement => {
  const sections = screen.getByTestId('add-reg-datetime-input').parentElement
  if (!sections) throw new Error('the datetime picker rendered no sections container')
  return sections
}

/** The dialog opened on a register, which is what puts the two buttons up. */
const renderEditing = (register: ServerRegister[number]): void => {
  useAddRegisterZustand.getState().setEditRegister(register)
  render(<AddRegister />)
}

const allFieldsValid = {
  address: true,
  value: true,
  min: true,
  max: true,
  interval: true,
  registerLength: true,
  stringValue: true,
  start: true,
  step: true
}

describe('what the edit dialog opens with', () => {
  beforeEach(() => {
    useAddRegisterZustand.getState().resetToDefaults()
  })

  // A field marked wrong paints its label as an error, and the register on
  // screen was valid when it was added.
  it('marks nothing wrong when a fixed register opens', () => {
    renderEditing(registerAt100)

    expect(useAddRegisterZustand.getState().valid).toEqual(allFieldsValid)
  })

  it('marks nothing wrong when a generator opens', () => {
    renderEditing(generatorAt100)

    expect(useAddRegisterZustand.getState().valid).toEqual(allFieldsValid)
  })

  // The dialog offers both sets and the register carries one, so switching has
  // to land on something submittable.
  it('has a range ready when a fixed register is switched to Generator', async () => {
    const user = userEvent.setup()
    renderEditing(registerAt100)

    await user.click(screen.getByTestId('add-reg-generator-btn'))

    expect(fieldInput('add-reg-min-input')).toHaveValue('0')
    expect(fieldInput('add-reg-max-input')).toHaveValue('1')
    expect(submitButton()).toBeEnabled()
  })

  it('has a value ready when a generator is switched to Fixed', async () => {
    const user = userEvent.setup()
    renderEditing(generatorAt100)

    await user.click(screen.getByTestId('add-reg-fixed-btn'))

    expect(fieldInput('add-reg-value-input')).toHaveValue('0')
    expect(submitButton()).toBeEnabled()
  })
})

describe('the edit dialog buttons', () => {
  beforeEach(() => {
    mockRemoveRegister.mockClear()
    useAddRegisterZustand.getState().resetToDefaults()
  })

  it('offers Remove and not Submit Change while nothing has been typed', () => {
    renderEditing(registerAt100)

    expect(submitButton()).toBeDisabled()
    expect(removeButton()).toBeEnabled()
  })

  it('offers Submit Change and not Remove once the address is changed', async () => {
    const user = userEvent.setup()
    renderEditing(registerAt100)

    const address = fieldInput('add-reg-address-input')
    await user.clear(address)
    await user.type(address, '200')

    expect(submitButton()).toBeEnabled()
    expect(removeButton()).toBeDisabled()
  })

  // Any field, not only the address the buttons were wrong about.
  it('takes a comment as a change too', async () => {
    const user = userEvent.setup()
    renderEditing(registerAt100)

    await user.type(fieldInput('add-reg-comment-input'), '!')

    expect(submitButton()).toBeEnabled()
    expect(removeButton()).toBeDisabled()
  })

  it('offers Remove again when the address is typed back', async () => {
    const user = userEvent.setup()
    renderEditing(registerAt100)

    const address = fieldInput('add-reg-address-input')
    await user.clear(address)
    await user.type(address, '200')
    await user.clear(address)
    await user.type(address, '100')

    expect(submitButton()).toBeDisabled()
    expect(removeButton()).toBeEnabled()
  })

  // The picker reads `value`, so what the store holds is what it draws.
  it('opens a fixed datetime on the timestamp the register holds', () => {
    renderEditing(datetimeAt100)

    expect(useAddRegisterZustand.getState().value).toBe(String(JUNE_2024_MS))
  })

  it('opens a fixed unix on the timestamp the register holds', () => {
    renderEditing(unixAt100)

    expect(useAddRegisterZustand.getState().value).toBe(String(JUNE_2024_MS - 789))
  })

  it('offers Remove and not Submit Change for a datetime nothing was typed into', () => {
    renderEditing(datetimeAt100)

    expect(submitButton()).toBeDisabled()
    expect(removeButton()).toBeEnabled()
  })

  // The window is the register's, not the picker's, and the two registers do
  // not share one: IEC 870-5 runs to the end of 2127, a uint32 of seconds to
  // 2106/02/07. A date outside greys out Submit Change the way a bad number does.
  it('takes a datetime inside the window the format carries', async () => {
    const user = userEvent.setup()
    renderEditing(datetimeAt100)

    await user.click(datetimeSections())
    await user.keyboard('06152110')

    expect(datetimeSections()).toHaveAttribute('aria-invalid', 'false')
    expect(submitButton()).toBeEnabled()
  })

  it('refuses a datetime past the year the format ends at', async () => {
    const user = userEvent.setup()
    renderEditing(datetimeAt100)

    await user.click(datetimeSections())
    await user.keyboard('06152200')

    expect(datetimeSections()).toHaveAttribute('aria-invalid', 'true')
    expect(submitButton()).toBeDisabled()
  })

  it('takes a unix timestamp inside the range a uint32 of seconds covers', async () => {
    const user = userEvent.setup()
    renderEditing(unixAt100)

    await user.click(datetimeSections())
    await user.keyboard('06152024')

    expect(datetimeSections()).toHaveAttribute('aria-invalid', 'false')
    expect(submitButton()).toBeEnabled()
  })

  it('refuses for unix the same year it takes for datetime', async () => {
    const user = userEvent.setup()
    renderEditing(unixAt100)

    await user.click(datetimeSections())
    await user.keyboard('06152110')

    expect(datetimeSections()).toHaveAttribute('aria-invalid', 'true')
    expect(submitButton()).toBeDisabled()
  })

  // The picker has to show a date, and a generator carries none, so the type
  // seeds the current time. Setting the type first made the value branch below
  // it write the epoch over that seed.
  it('opens a timestamp generator on a date the picker can show', () => {
    const openedAt = Date.now()
    renderEditing(timestampGeneratorAt100('unix'))

    expect(Number(useAddRegisterZustand.getState().value)).toBeGreaterThanOrEqual(openedAt)
  })

  // `getValueRangeError` leaves `datetime` alone, because
  // `encodeIEC870DateTime` clamps rather than throws, so this arrives from a
  // config file and the field is where it is said.
  it('marks a stored datetime outside the window wrong before anything is typed', () => {
    renderEditing(timestampAt100('datetime', Date.UTC(2200, 0, 1)))

    expect(datetimeSections()).toHaveAttribute('aria-invalid', 'true')
    expect(useAddRegisterZustand.getState().valid.value).toBe(false)
  })

  // `setDataType` forces a bitmap fixed, and the dialog draws no Fixed/Generator
  // toggle for one, so opening it as a generator leaves no way back.
  it('opens a bitmap fixed even when the register it reads generates', () => {
    renderEditing(bitmapGeneratorAt100)

    expect(useAddRegisterZustand.getState().fixed).toBe(true)
    expect(fieldInput('add-reg-value-input')).toBeVisible()
  })

  // Add & Next keeps the type and clears the value, and for a timestamp the
  // cleared value is the current time: '0' left the picker showing now over a
  // store holding the epoch, and the next Add wrote the epoch.
  it('leaves Add & Next on a date the picker can show', async () => {
    const user = userEvent.setup()
    useAddRegisterZustand.getState().setRegisterType('holding_registers')
    render(<AddRegister />)
    // The add-mode effect resets the dialog on mount, so the type is picked
    // after it has run, the way a user picks it.
    await act(async () => useAddRegisterZustand.getState().setDataType('datetime'))

    const clickedAt = Date.now()
    await user.click(screen.getByTestId('add-reg-next-btn'))

    expect(Number(useAddRegisterZustand.getState().value)).toBeGreaterThanOrEqual(clickedAt)
  })

  it('removes the register it was opened on', async () => {
    const user = userEvent.setup()
    renderEditing(registerAt100)

    await user.click(removeButton())

    expect(mockRemoveRegister).toHaveBeenCalledWith({
      uuid: 'main',
      unitId: '0',
      address: 100,
      registerType: 'holding_registers',
      dataType: 'uint32',
      length: undefined
    })
  })
})

/** A stored ramp that holds at its bound, which is not what the dialog defaults to. */
const rampAt100: ServerRegister[number] = {
  value: 0,
  params: {
    address: 100,
    registerType: 'holding_registers',
    dataType: 'uint16',
    comment: 'humidity',
    min: 0,
    max: 10,
    interval: 2000,
    mode: 'ramp',
    start: 5,
    step: 2,
    restart: false
  }
}

/** The testid sits on the MUI checkbox root, and the box a user ticks is inside it. */
const restartCheckbox = (): HTMLElement =>
  within(screen.getByTestId('add-reg-restart-checkbox')).getByRole('checkbox')

/** The add dialog for a holding register, after its own reset has run. */
const renderAdding = (): void => {
  useAddRegisterZustand.getState().setRegisterType('holding_registers')
  render(<AddRegister />)
}

describe('ramp mode', () => {
  beforeEach(() => {
    useAddRegisterZustand.getState().resetToDefaults()
  })

  it('shows the ramp fields and a ticked Restart once Ramp is picked', async () => {
    const user = userEvent.setup()
    renderAdding()

    await user.click(screen.getByTestId('add-reg-ramp-btn'))

    for (const testId of [
      'add-reg-start-input',
      'add-reg-step-input',
      'add-reg-min-input',
      'add-reg-max-input',
      'add-reg-interval-input'
    ]) {
      expect(screen.getByTestId(testId)).toBeVisible()
    }
    expect(restartCheckbox()).toBeChecked()
  })

  it('offers no Ramp for a unix register', async () => {
    renderAdding()
    await act(async () => useAddRegisterZustand.getState().setDataType('unix'))

    expect(screen.queryByTestId('add-reg-ramp-btn')).not.toBeInTheDocument()
  })

  it('refuses a step of 0 and says so on the step field', async () => {
    const user = userEvent.setup()
    renderAdding()
    await user.click(screen.getByTestId('add-reg-ramp-btn'))

    const step = fieldInput('add-reg-step-input')
    await user.clear(step)
    await user.type(step, '0')

    expect(submitButton()).toBeDisabled()
    expect(step).toHaveAttribute('aria-invalid', 'true')
  })

  it('opens a stored ramp in Ramp mode with its own fields, and clean', () => {
    renderEditing(rampAt100)

    expect(screen.getByTestId('add-reg-ramp-btn')).toHaveAttribute('aria-pressed', 'true')
    expect(fieldInput('add-reg-start-input')).toHaveValue('5')
    expect(fieldInput('add-reg-step-input')).toHaveValue('2')
    expect(restartCheckbox()).not.toBeChecked()
    expect(submitButton()).toBeDisabled()
    expect(removeButton()).toBeEnabled()
  })
})

/** The params the dialog last handed the server store. */
const submittedParams = (): unknown => {
  const call = serverState.addRegister.mock.calls.at(-1) as unknown as
    | [{ params: unknown }]
    | undefined
  if (!call) throw new Error('the dialog submitted nothing')
  return call[0].params
}

/** A ramp like `rampAt100`, as `dataType` and stepping by `step`. */
const rampOf = (
  dataType: 'uint16' | 'int16' | 'float' | 'double',
  step: number
): ServerRegister[number] => ({
  value: 0,
  params: {
    address: 100,
    registerType: 'holding_registers',
    dataType,
    comment: 'humidity',
    min: 0,
    max: 10,
    interval: 2000,
    mode: 'ramp',
    start: 5,
    step,
    restart: false
  }
})

// The Step field masked to the type's span, and the edit effect hands it the
// stored step as `String(step)`. A step the field cannot show came back from
// the mask changed, and saving an edit to the comment saved that change.
describe('a ramp step through an edit of another field', () => {
  beforeEach(() => {
    useAddRegisterZustand.getState().resetToDefaults()
    serverState.addRegister.mockClear()
  })

  it.each([
    ['uint16', 65535],
    ['uint16', -65535],
    ['int16', 65535],
    ['float', 0.0000001],
    ['float', 0.1234567],
    ['double', Number.MAX_SAFE_INTEGER],
    ['double', -0.5]
  ] as const)('keeps a %s step of %d', async (dataType, step) => {
    const register = rampOf(dataType, step)
    expect(RegisterParamsSchema.safeParse(register.params).success).toBe(true)
    const user = userEvent.setup()
    renderEditing(register)

    await user.type(fieldInput('add-reg-comment-input'), '!')
    await user.click(submitButton())

    expect(submittedParams()).toMatchObject({ comment: 'humidity!', step })
  })

  it.each([
    ['uint16', '70000', 65535],
    ['double', '99999999999999999999', Number.MAX_SAFE_INTEGER],
    ['float', '0.123456789', 0.1234567]
  ] as const)(
    'takes from a %s Step field only a step the schema takes',
    async (dataType, typed, step) => {
      const user = userEvent.setup()
      renderEditing(rampOf(dataType, 1))

      const stepField = fieldInput('add-reg-step-input')
      await user.clear(stepField)
      await user.type(stepField, typed)
      await user.click(submitButton())

      expect(submittedParams()).toMatchObject({ step })
      expect(RegisterParamsSchema.safeParse(submittedParams()).success).toBe(true)
    }
  )
})
