export interface RampSpec {
  start: number
  step: number
  min: number
  max: number
  restart: boolean
}

/** Where the ramp is: `stepCount` steps away from `start`. */
export type RampTick = { kind: 'value'; value: number; stepCount: number } | { kind: 'hold' }

/**
 * The most decimals a ramp number is read with. A float or double ramp
 * holds 7 (`RAMP_DECIMALS`); the rest is headroom.
 */
const MAX_DECIMALS = 20

/** The fewest decimals, up to `MAX_DECIMALS`, that write `value` back as itself. */
const decimalsOf = (value: number): number => {
  for (let decimals = 0; decimals < MAX_DECIMALS; decimals++) {
    if (Number(value.toFixed(decimals)) === value) return decimals
  }
  return MAX_DECIMALS
}

/**
 * `value` times `10 ** decimals` as a `BigInt`, for `decimals` no fewer than
 * `decimalsOf(value)`. The number is written at its own decimals and the rest
 * is a power of ten, because `toFixed` past those decimals prints the digits
 * of the float64: 1000000000000.1 at 7 is 1000000000000.0999756. From 1e21
 * up `toFixed` writes an exponent, and every double that large is a whole
 * number.
 */
const scaled = (value: number, decimals: number): bigint => {
  const own = decimalsOf(value)
  const digits =
    Math.abs(value) < 1e21 ? BigInt(value.toFixed(own).replace('.', '')) : BigInt(value)
  return digits * 10n ** BigInt(decimals - own)
}

/**
 * The tick after `stepCount`.
 *
 * The value is `start + n * step` rather than the last value plus `step`, so a
 * float ramp carries no sum of rounding errors. It is worked out and compared
 * with the bounds in `BigInt`, on the decimals the four numbers are written
 * with, so `0.1 * 3` reaches a max of 0.3 and an overshoot of any size holds.
 * An int64 step reaches about 2 ** 54, where `n * step` in a `Number` leaves
 * the safe-integer range.
 */
export const nextRampTick = (spec: RampSpec, stepCount: number): RampTick => {
  const nextCount = stepCount + 1
  const decimals = Math.max(...[spec.start, spec.step, spec.min, spec.max].map(decimalsOf))
  const value = scaled(spec.start, decimals) + BigInt(nextCount) * scaled(spec.step, decimals)

  if (value >= scaled(spec.min, decimals) && value <= scaled(spec.max, decimals)) {
    return { kind: 'value', value: Number(`${value}e-${decimals}`), stepCount: nextCount }
  }
  return spec.restart ? { kind: 'value', value: spec.start, stepCount: 0 } : { kind: 'hold' }
}
