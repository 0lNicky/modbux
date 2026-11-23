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

  it('reaches min after 600 float steps down', () => {
    const spec = { ...base, start: 80, step: -0.1, min: 20, max: 80, fractional: true }
    expect(run(spec, 600).at(-1)).toBe(20)
  })
})
