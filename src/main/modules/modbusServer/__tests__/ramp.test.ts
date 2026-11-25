import { describe, it, expect } from 'vitest'
import { nextRampTick, type RampSpec } from '../ramp'

/** The values `ticks` ticks write, folded from step 0, stopping at the first hold. */
const run = (spec: RampSpec, ticks: number): number[] => {
  const written: number[] = []
  let stepCount = 0
  for (let tick = 0; tick < ticks; tick++) {
    const next = nextRampTick(spec, stepCount)
    if (next.kind === 'hold') break
    written.push(next.value)
    stepCount = next.stepCount
  }
  return written
}

const base: RampSpec = { start: 0, step: 1, min: 0, max: 3, restart: true, fractional: false }

describe('nextRampTick', () => {
  it('climbs to max and returns to start', () => {
    expect(run(base, 5)).toEqual([1, 2, 3, 0, 1])
  })

  it('descends to min and returns to start', () => {
    expect(run({ ...base, start: 3, step: -1 }, 5)).toEqual([2, 1, 0, 3, 2])
  })

  it('holds at the last value inside the bounds when restart is off', () => {
    expect(run({ ...base, restart: false }, 5)).toEqual([1, 2, 3])
  })

  it('never writes past max when the step does not divide the range', () => {
    expect(run({ ...base, step: 2 }, 3)).toEqual([2, 0, 2])
  })

  it('stays on start when one step overshoots the whole range', () => {
    expect(run({ ...base, start: 5, step: 100, min: 0, max: 10 }, 3)).toEqual([5, 5, 5])
  })

  it('holds at once when start sits on the bound the step walks toward', () => {
    expect(run({ ...base, start: 3, restart: false }, 3)).toEqual([])
  })

  // 0.1 * 3 is 0.30000000000000004, so the third value is the snap to max.
  it('writes a float bound that the step reaches only within rounding', () => {
    expect(run({ ...base, step: 0.1, max: 0.3, fractional: true }, 4)).toEqual([0.1, 0.2, 0.3, 0])
  })

  // The tolerance was 1e-9 at the least, wider than this whole range, and min
  // was matched first, so the first three ticks all wrote 0.
  it('moves a float step finer than the tolerance, and snaps only to the bound it walks toward', () => {
    const spec = { ...base, step: 1e-10, max: 5e-10, fractional: true }
    const written = run(spec, 6)
    expect(written.slice(0, 4).map((value) => Math.round(value * 1e10))).toEqual([1, 2, 3, 4])
    expect(written.slice(4)).toEqual([5e-10, 0])
  })

  it('moves a falling float step finer than the tolerance, and snaps it to min', () => {
    const spec = { ...base, start: 5e-10, step: -1e-10, min: 0, max: 5e-10, fractional: true }
    const written = run(spec, 6)
    expect(written.slice(0, 4).map((value) => Math.round(value * 1e10))).toEqual([4, 3, 2, 1])
    expect(written.slice(4)).toEqual([0, 5e-10])
  })

  // 10 - 1e-10 is within 1e-9 * 10 of max, so the first step down wrote 10.
  it('does not snap a falling float ramp back to the max it leaves', () => {
    const spec = { ...base, start: 10, step: -1e-10, min: 0, max: 10, fractional: true }
    expect(nextRampTick(spec, 0)).toEqual({ kind: 'value', value: 10 - 1e-10, stepCount: 1 })
  })

  // 10 + 1e-10 is within 1e-9 * 10 of max, so it was written as 10 and the
  // ramp went on ticking until the distance outgrew the tolerance.
  it('holds at once when the first float step leaves the bounds, however small', () => {
    const spec = { ...base, start: 10, step: 1e-10, max: 10, restart: false, fractional: true }
    expect(nextRampTick(spec, 0)).toEqual({ kind: 'hold' })
  })

  // `1e-9 * |bound|` is 0.1 at 1e8, so a tolerance that grows with the bound
  // alone wrote these overshoots as max.
  it.each([
    [1e8, 0.1, 1e8 + 0.05],
    [1e8, 0.1, 1e8 + 0.06],
    [1e9, 1, 1e9 + 0.5]
  ])('holds when a float step from %d by %d overshoots a max of %d', (start, step, max) => {
    const spec = { start, step, min: start, max, restart: false, fractional: true }
    expect(nextRampTick(spec, 0)).toEqual({ kind: 'hold' })
  })

  // 12345.6 + 2 * 0.1 is 12345.800000000001.
  it('writes a float max that a ramp far from 0 reaches only within rounding', () => {
    const spec = {
      ...base,
      start: 12345.6,
      step: 0.1,
      min: 12345.6,
      max: 12345.8,
      fractional: true
    }
    expect(run(spec, 3)).toEqual([12345.7, 12345.8, 12345.6])
  })

  // The third product, 3 * 4503599627370497, is past 2 ** 53, so it rounded
  // and the sum came out 1 high.
  it('writes an int64 ramp exactly where n * step leaves the safe-integer range', () => {
    const spec = {
      ...base,
      start: -Number.MAX_SAFE_INTEGER,
      step: 4503599627370497,
      min: -Number.MAX_SAFE_INTEGER,
      max: Number.MAX_SAFE_INTEGER,
      restart: false
    }
    expect(run(spec, 4)).toEqual([-4503599627370494, 3, 4503599627370500])
  })

  it('reaches min after 600 float steps down', () => {
    const spec = { ...base, start: 80, step: -0.1, min: 20, max: 80, fractional: true }
    expect(run(spec, 600).at(-1)).toBe(20)
  })
})
