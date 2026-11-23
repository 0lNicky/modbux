/**
 * What value the register produces: a fixed one, or a generator.
 *
 * The fields swap with the data type and the generator mode, so all of them
 * are one subject.
 */
import Checkbox from '@mui/material/Checkbox'
import FormControlLabel from '@mui/material/FormControlLabel'
import { InputBaseComponentProps } from '@mui/material/InputBase'
import TextField from '@mui/material/TextField'
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import { useAddRegisterZustand } from './addRegister.zustand'
import { meme } from '@renderer/components/shared/inputs/meme'
import { maskInputProps } from '@renderer/components/shared/inputs/types'
import {
  inTimestampWindow,
  isTimestampType,
  rampFieldErrors,
  timestampWindow,
  utf8MaxBytes
} from './addRegister.zustand.helpers'
import { ChangeEvent, ElementType, useCallback, useEffect, useMemo } from 'react'
import { DateTimePicker } from '@mui/x-date-pickers/DateTimePicker'
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider'
import { AdapterLuxon } from '@mui/x-date-pickers/AdapterLuxon'
import { DateTime } from 'luxon'
import {
  ValueInput,
  MinInput,
  MaxInput,
  IntervalInput,
  RegisterLengthInput,
  StartInput,
  StepInput
} from './maskedInputs'
import { GeneratorMode } from '@shared'

/** What the toggle offers: a fixed value, or one of the generator modes. */
type ValueSource = 'fixed' | GeneratorMode

export const FixedOrGenerator = meme(() => {
  const fixed = useAddRegisterZustand((z) => z.fixed)
  const generatorMode = useAddRegisterZustand((z) => z.generatorMode)
  const dataType = useAddRegisterZustand((z) => z.dataType)

  // Fixed leaves the generator mode as it was, so Generator or Ramp picked
  // again comes back the way it was left.
  const handleChange = useCallback((_event: unknown, value: ValueSource | null): void => {
    if (value === null) return
    const addRegisterZustand = useAddRegisterZustand.getState()
    if (value === 'fixed') {
      addRegisterZustand.setFixed(true)
      return
    }
    addRegisterZustand.setFixed(false)
    addRegisterZustand.setGeneratorMode(value)
  }, [])

  // UTF-8 and BITMAP are always fixed — hide toggle
  if (dataType === 'utf8' || dataType === 'bitmap') return null

  const value: ValueSource = fixed ? 'fixed' : generatorMode

  return (
    <ToggleButtonGroup
      size="small"
      exclusive
      color="primary"
      value={value}
      onChange={handleChange}
      sx={{ flex: 1 }}
    >
      <ToggleButton data-testid="add-reg-fixed-btn" sx={{ flex: 1, flexBasis: 0 }} value="fixed">
        Fixed
      </ToggleButton>
      <ToggleButton
        data-testid="add-reg-generator-btn"
        sx={{ flex: 1, flexBasis: 0 }}
        value="random"
      >
        Generator
      </ToggleButton>
      {/* A timestamp generator reads the clock, so there is nothing to ramp. */}
      {!isTimestampType(dataType) && (
        <ToggleButton data-testid="add-reg-ramp-btn" sx={{ flex: 1, flexBasis: 0 }} value="ramp">
          Ramp
        </ToggleButton>
      )}
    </ToggleButtonGroup>
  )
})

//
//
//
//
// Value Input

const ValueInputComponent = meme(() => {
  const value = useAddRegisterZustand((z) => z.value)
  const valid = useAddRegisterZustand((z) => z.valid.value)

  const setValue = useAddRegisterZustand.getState().setValue

  return (
    <TextField
      data-testid="add-reg-value-input"
      label="Value"
      variant="outlined"
      size="small"
      sx={{ minWidth: 100 }}
      value={value}
      error={!valid}
      slotProps={{
        input: {
          inputComponent: ValueInput as unknown as ElementType<InputBaseComponentProps, 'input'>,
          inputProps: maskInputProps({ set: setValue })
        }
      }}
    />
  )
})

//
//
//
//
// Min/Max Masks

const MinTextField = meme(() => {
  const min = useAddRegisterZustand((z) => String(z.min))
  // A ramp reads min and max as bounds, so one above the other is refused
  // there and nowhere else.
  const valid = useAddRegisterZustand(
    (z) => z.valid.min && !(z.generatorMode === 'ramp' && rampFieldErrors(z).range)
  )

  const setMin = useAddRegisterZustand.getState().setMin

  return (
    <TextField
      data-testid="add-reg-min-input"
      error={!valid}
      label="Min Value"
      variant="outlined"
      size="small"
      sx={{ width: 90 }}
      value={min}
      slotProps={{
        input: {
          inputComponent: MinInput as unknown as ElementType<InputBaseComponentProps, 'input'>,
          inputProps: maskInputProps({ set: setMin })
        }
      }}
    />
  )
})

const MaxTextField = meme(() => {
  const max = useAddRegisterZustand((z) => String(z.max))
  const valid = useAddRegisterZustand((z) => z.valid.max)

  const setMax = useAddRegisterZustand.getState().setMax

  return (
    <TextField
      data-testid="add-reg-max-input"
      error={!valid}
      label="Max Value"
      variant="outlined"
      size="small"
      sx={{ width: 90 }}
      value={max}
      slotProps={{
        input: {
          inputComponent: MaxInput as unknown as ElementType<InputBaseComponentProps, 'input'>,
          inputProps: maskInputProps({ set: setMax })
        }
      }}
    />
  )
})

//
//
//
//
// Ramp

const StartTextField = meme(() => {
  const start = useAddRegisterZustand((z) => z.start)
  const valid = useAddRegisterZustand((z) => z.valid.start && !rampFieldErrors(z).start)

  const setStart = useAddRegisterZustand.getState().setStart

  return (
    <TextField
      data-testid="add-reg-start-input"
      error={!valid}
      label="Start"
      variant="outlined"
      size="small"
      sx={{ width: 90 }}
      value={start}
      slotProps={{
        input: {
          inputComponent: StartInput as unknown as ElementType<InputBaseComponentProps, 'input'>,
          inputProps: maskInputProps({ set: setStart })
        }
      }}
    />
  )
})

const StepTextField = meme(() => {
  const step = useAddRegisterZustand((z) => z.step)
  const valid = useAddRegisterZustand((z) => z.valid.step && !rampFieldErrors(z).step)

  const setStep = useAddRegisterZustand.getState().setStep

  return (
    <TextField
      data-testid="add-reg-step-input"
      error={!valid}
      label="Step"
      variant="outlined"
      size="small"
      sx={{ width: 90 }}
      value={step}
      slotProps={{
        input: {
          inputComponent: StepInput as unknown as ElementType<InputBaseComponentProps, 'input'>,
          inputProps: maskInputProps({ set: setStep })
        }
      }}
    />
  )
})

const RestartCheckbox = meme(() => {
  const restart = useAddRegisterZustand((z) => z.restart)

  const handleChange = useCallback((event: ChangeEvent<HTMLInputElement>): void => {
    const addRegisterZustand = useAddRegisterZustand.getState()
    addRegisterZustand.setRestart(event.target.checked)
  }, [])

  return (
    <FormControlLabel
      control={
        <Checkbox
          size="small"
          checked={restart}
          onChange={handleChange}
          data-testid="add-reg-restart-checkbox"
        />
      }
      label="Restart"
    />
  )
})

//
//
//
//
// Interval

const IntervalTextField = meme(() => {
  const interval = useAddRegisterZustand((z) => String(z.interval))
  const valid = useAddRegisterZustand((z) => z.valid.interval)

  const setInterval = useAddRegisterZustand.getState().setInterval

  return (
    <TextField
      data-testid="add-reg-interval-input"
      error={!valid}
      label="Interval (s)"
      variant="outlined"
      size="small"
      sx={{ width: 90 }}
      value={interval}
      slotProps={{
        input: {
          inputComponent: IntervalInput as unknown as ElementType<InputBaseComponentProps, 'input'>,
          inputProps: maskInputProps({ set: setInterval })
        }
      }}
    />
  )
})

//
//
//
//
// DateTimePicker for unix/datetime fixed mode

const DateTimeField = meme(() => {
  const value = useAddRegisterZustand((z) => z.value)
  const dataType = useAddRegisterZustand((z) => z.dataType)
  const showDatePickerUtc = useAddRegisterZustand((z) => z.showDatePickerUtc)

  const { minDate, maxDate } = useMemo(() => {
    const { min, max } = timestampWindow(dataType)
    return { minDate: DateTime.fromMillis(min), maxDate: DateTime.fromMillis(max) }
  }, [dataType])

  const handleChange = useCallback(
    (dt: DateTime | null): void => {
      if (!dt || !dt.isValid) return
      const addRegisterZustand = useAddRegisterZustand.getState()

      const milliseconds = dt.toMillis()
      addRegisterZustand.setValue(String(milliseconds), inTimestampWindow(dataType, milliseconds))
    },
    [dataType]
  )

  const handleUtcChange = useCallback((): void => {
    const addRegisterZustand = useAddRegisterZustand.getState()
    addRegisterZustand.setShowDatePickerUtc(!addRegisterZustand.showDatePickerUtc)
  }, [])

  // What the store holds, always: a picker showing a date nothing wrote back is
  // a date the Add button sends nothing of. `setDataType` seeds the current
  // time when the type becomes a timestamp, and so does Add & Next.
  const dateValue = DateTime.fromMillis(Number(value))

  return (
    <LocalizationProvider dateAdapter={AdapterLuxon}>
      <DateTimePicker
        timezone={showDatePickerUtc ? 'UTC' : undefined}
        label="Date & Time"
        value={dateValue}
        onChange={handleChange}
        minDate={minDate}
        maxDate={maxDate}
        ampm={false}
        slotProps={{
          textField: {
            size: 'small',
            sx: { minWidth: 220 },
            // v9 renders a PickersTextField here, not a Material TextField, so
            // the html input is reached through its own nested slotProps.
            slotProps: { htmlInput: { 'data-testid': 'add-reg-datetime-input' } }
          }
        }}
      />
      <ToggleButtonGroup size="small" value={showDatePickerUtc} color="primary">
        <ToggleButton
          value={true}
          data-testid="add-reg-datetime-show-utc"
          aria-label="Show UTC time for datepicker"
          title="Toggle UTC/local display — register is always encoded in UTC"
          onChange={handleUtcChange}
        >
          UTC
        </ToggleButton>
      </ToggleButtonGroup>
    </LocalizationProvider>
  )
})

//
//
//
//
// String value input for utf8

const StringValueField = meme(() => {
  const stringValue = useAddRegisterZustand((z) => z.stringValue)
  const maxBytes = useAddRegisterZustand((z) => utf8MaxBytes(z.registerLength))
  const valid = useAddRegisterZustand((z) => z.valid.stringValue)

  const handleChange = useCallback((event: ChangeEvent<HTMLInputElement>): void => {
    const addRegisterZustand = useAddRegisterZustand.getState()
    addRegisterZustand.setStringValue(event.target.value)
  }, [])

  useEffect(() => {
    // Reevaluate string length when changing register Length
    const addRegisterZustand = useAddRegisterZustand.getState()
    addRegisterZustand.setStringValue(addRegisterZustand.stringValue)
  }, [maxBytes])

  const helperText = `${new TextEncoder().encode(stringValue).length} / ${maxBytes} bytes`

  return (
    <TextField
      data-testid="add-reg-string-input"
      label="String Value"
      variant="outlined"
      size="small"
      sx={{ minWidth: 200, flex: 1 }}
      value={stringValue}
      onChange={handleChange}
      helperText={helperText}
      error={!valid}
    />
  )
})

//
//
//
//
// Register length input for utf8

const RegisterLengthField = meme(() => {
  const registerLength = useAddRegisterZustand((z) => z.registerLength)
  const valid = useAddRegisterZustand((z) => z.valid.registerLength)

  const setRegisterLength = useAddRegisterZustand.getState().setRegisterLength

  return (
    <TextField
      data-testid="add-reg-length-input"
      error={!valid}
      label="Registers"
      variant="outlined"
      size="small"
      sx={{ width: 90 }}
      value={registerLength}
      slotProps={{
        input: {
          inputComponent: RegisterLengthInput as unknown as ElementType<
            InputBaseComponentProps,
            'input'
          >,
          inputProps: maskInputProps({ set: setRegisterLength })
        }
      }}
    />
  )
})

//
//
//
//
// ValueParameters

export const ValueParameters = meme(() => {
  const fixed = useAddRegisterZustand((z) => z.fixed)
  const generatorMode = useAddRegisterZustand((z) => z.generatorMode)
  const dataType = useAddRegisterZustand((z) => z.dataType)

  // UTF-8: string input + register length
  if (dataType === 'utf8') {
    return (
      <>
        <StringValueField />
        <RegisterLengthField />
      </>
    )
  }

  // Unix/datetime fixed: date picker
  if (['unix', 'datetime'].includes(dataType) && fixed) {
    return <DateTimeField />
  }

  // Unix/datetime generator: only interval
  if (['unix', 'datetime'].includes(dataType) && !fixed) {
    return <IntervalTextField />
  }

  // Numeric fixed: value input
  if (fixed) {
    return <ValueInputComponent />
  }

  if (generatorMode === 'ramp') {
    return (
      <>
        <StartTextField />
        <StepTextField />
        <MinTextField />
        <MaxTextField />
        <IntervalTextField />
        <RestartCheckbox />
      </>
    )
  }

  // Numeric generator: min/max/interval
  return (
    <>
      <MinTextField />
      <MaxTextField />
      <IntervalTextField />
    </>
  )
})
