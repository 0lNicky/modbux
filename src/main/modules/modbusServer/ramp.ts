export interface RampSpec {
  start: number
  step: number
  min: number
  max: number
  restart: boolean
  /** True for float and double: bounds are compared with a tolerance. */
  fractional: boolean
}

/** Where the ramp is: `stepCount` steps away from `start`. */
export type RampTick = { kind: 'value'; value: number; stepCount: number } | { kind: 'hold' }

/**
 * How far a float value may miss `bound` and still be written as it, the
 * shape of `isWhole` in `src/shared/pointTable.ts`. `0.1 * 3` is
 * `0.30000000000000004`, so without it a max of 0.3 is never written.
 */
const tolerance = (spec: RampSpec, bound: number): number =>
  spec.fractional ? 1e-9 * Math.max(1, Math.abs(bound)) : 0

/**
 * The tick after `stepCount`.
 *
 * The value is `start + n * step` rather than the last value plus `step`, so a
 * float ramp carries one rounding error rather than the sum of all of them.
 */
export const nextRampTick = (spec: RampSpec, stepCount: number): RampTick => {
  const nextCount = stepCount + 1
  const value = spec.start + nextCount * spec.step

  for (const bound of [spec.min, spec.max]) {
    if (Math.abs(value - bound) <= tolerance(spec, bound)) {
      return { kind: 'value', value: bound, stepCount: nextCount }
    }
  }
  if (value >= spec.min && value <= spec.max) {
    return { kind: 'value', value, stepCount: nextCount }
  }
  return spec.restart ? { kind: 'value', value: spec.start, stepCount: 0 } : { kind: 'hold' }
}
