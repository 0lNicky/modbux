/**
 * The eight masked inputs, each an IMask wrapper behind a forwardRef.
 *
 * Eight near-identical pairs, which is why they sit together: whatever is done
 * to one of them should be done to all eight, and that is easier to see here
 * than spread through the dialog.
 */
import { useAddRegisterZustand } from './addRegister.zustand'
import { decimalMask } from '@renderer/components/shared/inputs/decimalMask'
import { integerMask } from '@renderer/components/shared/inputs/integerMask'
import { meme } from '@renderer/components/shared/inputs/meme'
import { MaskInputProps } from '@renderer/components/shared/inputs/types'
import { forwardRef } from 'react'
import { IMaskInput } from 'react-imask'
import {
  MAX_UTF8_LENGTH,
  notEmpty,
  RAMP_STEP_DECIMALS,
  rampStepLimit,
  registerWidth
} from '@shared'
import { useMinMaxInteger } from '@renderer/hooks'

const AddressInputForward = forwardRef<HTMLInputElement, MaskInputProps>((props, ref) => {
  const { set, ...other } = props

  // Set maximum address based on data type
  const maxAddress = useAddRegisterZustand((z) =>
    Math.max(0, 65535 - registerWidth(z.dataType, Number(z.registerLength) || undefined) + 1)
  )

  return (
    <IMaskInput
      {...other}
      {...integerMask}
      min={0}
      max={maxAddress}
      autofix
      inputRef={ref}
      onAccept={(value) => set(value, notEmpty(value))}
    />
  )
})

AddressInputForward.displayName = 'AddressInput'

export const AddressInput = meme(AddressInputForward)

const ValueInputForward = forwardRef<HTMLInputElement, MaskInputProps>((props, ref) => {
  const { set, ...other } = props
  const dataType = useAddRegisterZustand((z) => z.dataType)
  const { min, max, integer } = useMinMaxInteger(dataType)

  return (
    <IMaskInput
      {...other}
      {...decimalMask(integer)}
      min={min}
      max={max}
      autofix
      inputRef={ref}
      onAccept={(value) => {
        set(value, notEmpty(value))
      }}
    />
  )
})

ValueInputForward.displayName = 'ValueInput'

export const ValueInput = meme(ValueInputForward)

const MinInputForward = forwardRef<HTMLInputElement, MaskInputProps>((props, ref) => {
  const { set, ...other } = props
  const dataType = useAddRegisterZustand((z) => z.dataType)
  const maxValue = useAddRegisterZustand((z) => z.max)
  const { min, max, integer } = useMinMaxInteger(dataType, 'min', maxValue)

  return (
    <IMaskInput
      {...other}
      {...decimalMask(integer)}
      min={min}
      max={max}
      autofix
      inputRef={ref}
      onAccept={(value) => set(value, notEmpty(value))}
    />
  )
})

MinInputForward.displayName = 'MinInput'

export const MinInput = meme(MinInputForward)

const MaxInputForward = forwardRef<HTMLInputElement, MaskInputProps>((props, ref) => {
  const { set, ...other } = props
  const dataType = useAddRegisterZustand((z) => z.dataType)
  const minValue = useAddRegisterZustand((z) => z.min)
  const { min, integer, max } = useMinMaxInteger(dataType, 'max', minValue)

  return (
    <IMaskInput
      {...other}
      {...decimalMask(integer)}
      min={min}
      max={max}
      autofix
      inputRef={ref}
      onAccept={(value) => set(value, notEmpty(value))}
    />
  )
})

MaxInputForward.displayName = 'MaxInput'

export const MaxInput = meme(MaxInputForward)

//
//
// Ramp

const StartInputForward = forwardRef<HTMLInputElement, MaskInputProps>((props, ref) => {
  const { set, ...other } = props
  const dataType = useAddRegisterZustand((z) => z.dataType)
  const { min, max, integer } = useMinMaxInteger(dataType)

  return (
    <IMaskInput
      {...other}
      {...decimalMask(integer)}
      min={min}
      max={max}
      autofix
      inputRef={ref}
      onAccept={(value) => set(value, notEmpty(value))}
    />
  )
})

StartInputForward.displayName = 'StartInput'

export const StartInput = meme(StartInputForward)

/**
 * A step runs either way up to `rampStepLimit`, so an unsigned type takes a
 * negative one too. The limit and the decimals are the ones
 * `RegisterParamsSchema` holds a ramp step to, so a step typed here is one the
 * schema takes, and a stored one comes back unchanged.
 */
const StepInputForward = forwardRef<HTMLInputElement, MaskInputProps>((props, ref) => {
  const { set, ...other } = props
  const dataType = useAddRegisterZustand((z) => z.dataType)
  const { integer } = useMinMaxInteger(dataType)
  const limit = rampStepLimit(dataType)

  return (
    <IMaskInput
      {...other}
      {...decimalMask(integer)}
      scale={integer ? 0 : RAMP_STEP_DECIMALS}
      min={-limit}
      max={limit}
      autofix
      inputRef={ref}
      onAccept={(value) => set(value, notEmpty(value))}
    />
  )
})

StepInputForward.displayName = 'StepInput'

export const StepInput = meme(StepInputForward)

//
//
// Interval

const IntervalInputForward = forwardRef<HTMLInputElement, MaskInputProps>((props, ref) => {
  const { set, ...other } = props

  return (
    <IMaskInput
      {...other}
      {...integerMask}
      min={1}
      max={10}
      autofix
      inputRef={ref}
      onAccept={(value) => set(value, notEmpty(value))}
    />
  )
})

IntervalInputForward.displayName = 'IntervalInput'

export const IntervalInput = meme(IntervalInputForward)

const RegisterLengthForward = forwardRef<HTMLInputElement, MaskInputProps>((props, ref) => {
  const { set, ...other } = props

  return (
    <IMaskInput
      {...other}
      {...integerMask}
      min={1}
      max={MAX_UTF8_LENGTH}
      autofix
      inputRef={ref}
      onAccept={(value) => set(value, notEmpty(value))}
    />
  )
})

RegisterLengthForward.displayName = 'RegisterLengthInput'

export const RegisterLengthInput = meme(RegisterLengthForward)
