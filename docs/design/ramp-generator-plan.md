# Ramp Generator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A server register can run in Ramp mode: start at a value, add a signed step every interval, and on passing a bound either return to the start or hold. The window and MCP both set it and read it back.

**Architecture:** Ramp is a variant of the existing generator, not a third kind of register. Four optional fields (`mode`, `start`, `step`, `restart`) join `min`, `max` and `interval` in `RegisterParamsGeneratorPartSchema`, and an absent `mode` means random, so stored configs need no migration. `ValueGenerator` branches on `mode`; the pure stepping rule lives in its own file so it is tested without timers.

**Tech Stack:** TypeScript, Zod, Electron main, React with MUI and react-imask, Zustand with Mutative, Vitest, Playwright.

**Spec:** `docs/design/ramp-generator.md`

## Global Constraints

- Branch `feature/ramp-generator`, PR into `develop` on `origin`. No version bump.
- Run `/test` before changing code and `/precommit` before each commit. Run `/prose` on every comment, commit message and markdown paragraph.
- No `any`, no `@ts-ignore`, no `!`, no inline lint disables.
- Nothing in `src/shared` imports from `src/main` or `electron`.
- One store selector per field. Actions are read through `getState()`, never selected.
- Every component is wrapped in `meme`. MUI is imported deep (`@mui/material/Checkbox`).
- Every interactive element carries a `data-testid`. The new ones are exactly `add-reg-ramp-btn`, `add-reg-start-input`, `add-reg-step-input`, `add-reg-restart-checkbox`.
- `interval` keeps the existing rule: whole seconds in the dialog, milliseconds stored, `z.number().int().min(1000).max(2147483647)`.
- `mode` absent and `mode: 'random'` behave identically, and existing generator tests pass unchanged.
- Defaults: `start` 0, `step` 1, `restart` true. Min and Max share state with the random generator and keep `FIELD_DEFAULTS`.
- Conventional Commits, lowercase, no period.

## Review Focus

1. **A float step that misses its bound.** `float`, start 0, step 0.1, max 0.3: the user expects 0.3 to be written before the restart. Pinned in Task 2.
2. **A step larger than the whole range.** Start 5, step 100, min 0, max 10, restart on: the user expects the value to stay 5 on every tick and never leave the bounds. Pinned in Task 2.
3. **Start sitting on the bound the step walks toward.** Start 10, step 1, max 10, restart off: the user expects 10 written once and no further writes. Pinned in Task 2 and Task 3.
4. **A hand-edited config with `mode: 'ramp'` and no `step`.** The user expects that one register dropped and the rest of the file loaded, the way an out-of-range `min` is treated now. Pinned in Task 1.
5. **Switching the data type to `unix` while Ramp is selected.** The user expects the dialog to fall back to Generator and stay submittable, not to send a ramp on a timestamp. Pinned in Task 4.

---

### Task 1: Schema

**Files:**
- Modify: `src/shared/types/server.ts` (`RegisterParamsGeneratorPartSchema`, `RegisterParamsStaticPartSchema`, the `superRefine` of `RegisterParamsSchema`)
- Test: `src/shared/__tests__/schemas.test.ts`

**Interfaces:**
- Produces: `GeneratorModeSchema = z.enum(['random', 'ramp'])` and `type GeneratorMode`, both exported from `@shared`.
- Produces: `RegisterParamsGeneratorPart` gains `mode?: GeneratorMode`, `start?: number`, `step?: number`, `restart?: boolean`.
- Produces: `isRampParams(params: { mode?: GeneratorMode }): boolean`, exported from `@shared`, true only for `mode === 'ramp'`.

- [ ] **Step 1: Write the failing tests** in a `describe('ramp generator')` block. `ramp` below is `{ address: 0, registerType: 'holding_registers', dataType: 'uint16', comment: '', min: 0, max: 10, interval: 1000, mode: 'ramp', start: 0, step: 1 }`.

  - accepts `ramp`, and accepts it with `restart: false`
  - accepts the same object with `mode`, `start`, `step` removed (a stored random generator)
  - rejects `{ ...ramp, step: 0 }` with an issue at path `['step']`
  - rejects `ramp` without `step`, and without `start`, with the issue at the missing field's path
  - rejects `{ ...ramp, min: 10, max: 0, start: 5 }` at `['min']`
  - rejects `{ ...ramp, start: 11 }` at `['start']`
  - rejects `{ ...ramp, step: 0.5 }` at `['step']` and `{ ...ramp, start: 0.5 }` at `['start']`
  - accepts `{ ...ramp, dataType: 'float', step: 0.5 }`
  - rejects `{ ...ramp, dataType }` for each of `unix`, `datetime`, `utf8`, `bitmap`, `none` at `['mode']`
  - rejects a random generator carrying `start`, `step` or `restart`, each at its own path
  - rejects a fixed register `{ ..., value: 1, mode: 'ramp' }`

- [ ] **Step 2: Run** `yarn test src/shared/__tests__/schemas.test.ts`. Expected: the new cases fail, the existing ones pass.

- [ ] **Step 3: Implement.** Add the four optional fields to the generator part and the four as `z.undefined()` to the static part. Add the refine rules to the existing `superRefine`. "Integer type" is every `dataType` for which `getMinMaxValues` is finite and the type is not `float` or `double`; reuse whatever `useMinMaxInteger` already reads to decide `integer` if it lives in shared, otherwise add `isIntegerDataType(dataType: DataType): boolean` to `src/shared/encoding.ts` and export it.

- [ ] **Step 4: Run** the same command. Expected: PASS. Then `yarn typecheck`. Expected: exit 0.

- [ ] **Step 5: Commit** `feat: add ramp fields to the generator schema`

---

### Task 2: The stepping rule

**Files:**
- Create: `src/main/modules/modbusServer/ramp.ts`
- Test: `src/main/modules/modbusServer/__tests__/ramp.test.ts`

**Interfaces:**
- Produces:

```ts
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
export type RampTick =
  | { kind: 'value'; value: number; stepCount: number }
  | { kind: 'hold' }
/** The tick after `stepCount`. */
export const nextRampTick = (spec: RampSpec, stepCount: number): RampTick
```

  `value` is `start + (stepCount + 1) * step` when that is inside the bounds, with a value inside the tolerance of a bound returned as the bound itself. Outside the bounds it is `{ kind: 'value', value: start, stepCount: 0 }` when `restart`, else `{ kind: 'hold' }`. The tolerance, for `fractional` only, is `1e-9 * Math.max(1, Math.abs(bound))`, the shape of `isWhole` in `src/shared/pointTable.ts`.

- [ ] **Step 1: Write the failing tests.** A helper `run(spec, ticks)` folds `nextRampTick` from `stepCount` 0 and returns the values written, stopping at `hold`.

```ts
const base = { start: 0, step: 1, min: 0, max: 3, restart: true, fractional: false }
expect(run(base, 5)).toEqual([1, 2, 3, 0, 1])
expect(run({ ...base, start: 3, step: -1 }, 5)).toEqual([2, 1, 0, 3, 2])
expect(run({ ...base, restart: false }, 5)).toEqual([1, 2, 3])
expect(run({ ...base, step: 2 }, 3)).toEqual([2, 0, 2])                       // never 4
expect(run({ ...base, start: 5, step: 100, min: 0, max: 10 }, 3)).toEqual([5, 5, 5])
expect(run({ ...base, start: 3, restart: false }, 3)).toEqual([])            // start on the bound
expect(run({ ...base, step: 0.1, max: 0.3, fractional: true }, 4)).toEqual([0.1, 0.2, 0.3, 0])
expect(run({ ...base, start: 80, step: -0.1, min: 20, max: 80, fractional: true }, 600).at(-1)).toBe(20)
```

  `0.1 * 2` is `0.2` and `0.1 * 3` is `0.30000000000000004`, so the third value asserts the snap to the bound.

- [ ] **Step 2: Run** `yarn test src/main/modules/modbusServer/__tests__/ramp.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement `nextRampTick`.**
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat: add the ramp stepping rule`

---

### Task 3: ValueGenerator runs a ramp

**Files:**
- Modify: `src/main/modules/modbusServer/valueGenerator.ts`
- Modify: `src/main/modules/modbusServer/registry.ts` (`addRegister` passes `mode`, `start`, `step`, `restart` to `new ValueGenerator`)
- Test: `src/main/modules/modbusServer/__tests__/valueGenerator.test.ts`, `src/main/modules/__tests__/modbusServer.test.ts`

**Interfaces:**
- Consumes: `nextRampTick`, `RampSpec` (Task 2); the schema fields (Task 1).
- Produces: `ValueGenerator` accepts the four fields through `RegisterParamsGeneratorPart`; `params` returns them when `mode === 'ramp'` and omits all four otherwise.

- [ ] **Step 1: Write the failing tests** with the file's existing fake-timer setup, on a `uint16` holding register at interval 1000:

  - `start: 5, step: 1, min: 0, max: 7`: the word is 5 after construction; 6, 7, 5 after one, two and three ticks
  - `restart: false`, same range: 5, 6, 7, then still 7 after three more ticks, and `vi.getTimerCount()` is 0
  - `start: 7, step: 1, max: 7, restart: false`: 7 after construction, `vi.getTimerCount()` is 0 after one tick
  - `dispose()` on a holding ramp does not throw and deletes the word
  - `params` of a ramp equals the params it was built from, including `restart: false`
  - `params` of a random generator has no `mode`, `start`, `step` or `restart` key
  - in `modbusServer.test.ts`: `addRegister` with ramp params, then `syncServerRegisters` from the params it reports, serves 5 again

- [ ] **Step 2: Run** `yarn test src/main/modules/modbusServer src/main/modules/__tests__/modbusServer.test.ts`. Expected: the new cases fail.
- [ ] **Step 3: Implement.** In ramp mode the constructor writes `start`, and each tick calls `nextRampTick`; on `hold` it clears the interval. `fractional` is `dataType` being `float` or `double`. `_updateValue` stays synchronous.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat: run ramp registers in the server`

---

### Task 4: The dialog

**Files:**
- Modify: `AddRegister/addRegister.zustand.ts`, `addRegister.zustand.helpers.ts`, `valueParameters.tsx`, `maskedInputs.tsx`, `addRegisterActions.tsx`, `AddRegister.tsx` (all under `src/renderer/src/components/server/ServerGrid/ServerRegisters/AddRegister/`)
- Test: the three files in that folder's `__tests__/`

**Interfaces:**
- Consumes: `GeneratorMode`, `isRampParams` (Task 1).
- Produces, on `RegisterFormValues` and the store: `generatorMode: GeneratorMode`, `start: string`, `step: string`, `restart: boolean`; setters `setGeneratorMode(mode: GeneratorMode)`, `setStart: MaskSetFn`, `setStep: MaskSetFn`, `setRestart(restart: boolean)`; `valid.start`, `valid.step`.
- Produces: `FIELD_DEFAULTS` gains `start: '0'`, `step: '1'`.
- Produces: `StartInput`, `StepInput` in `maskedInputs.tsx`.
- Produces: `isRampFormValid(form: Pick<RegisterFormValues, 'start' | 'step' | 'min' | 'max'>): boolean` in the helpers: step is not 0, min is not above max, start is within them.

`fixed` stays a boolean. The toggle shows `fixed ? 'fixed' : generatorMode`, and choosing Fixed leaves `generatorMode` as it was.

- [ ] **Step 1: Write the failing helper tests** (`addRegister.zustand.helpers.test.ts`):

  - `toRegisterParams` of a `uint16` form with `fixed: false, generatorMode: 'ramp', start: '80', step: '-1', min: '20', max: '80', interval: '2', restart: true` equals base plus `{ min: 20, max: 80, interval: 2000, mode: 'ramp', start: 80, step: -1, restart: true }`
  - the same form with `generatorMode: 'random'` has no `mode`, `start`, `step`, `restart` key
  - a `unix` form with `generatorMode: 'ramp'` gives `{ min: 0, max: 0, interval }` and no ramp key
  - `toFormSnapshot` carries the four new fields, and `isFormDirty` is true after changing only `restart`
  - `isRampFormValid`: false for step `'0'`, for start `'81'` with max `'80'`, for min `'5'` max `'1'`; true for the form above

- [ ] **Step 2: Write the failing store tests** (`addRegister.zustand.test.ts`):

  - `setGeneratorMode('ramp')` then `setDataType('unix')` leaves `generatorMode` as `'random'`; the same for `'datetime'`
  - `setDataType('utf8')` still forces `fixed` true
  - `resetToDefaults` restores `generatorMode: 'random'`, `start: '0'`, `step: '1'`, `restart: true`

- [ ] **Step 3: Write the failing component tests** (`AddRegister.test.tsx`):

  - clicking `add-reg-ramp-btn` shows `add-reg-start-input`, `add-reg-step-input`, `add-reg-min-input`, `add-reg-max-input`, `add-reg-interval-input` and a checked `add-reg-restart-checkbox`
  - with data type `unix`, `add-reg-ramp-btn` is not in the document
  - with step `0` the submit button is disabled and the step field has `aria-invalid="true"`
  - opening the dialog on a stored ramp register selects `add-reg-ramp-btn` and shows its start, step and unchecked restart, and the submit button reads as not dirty

- [ ] **Step 4: Run** `yarn test src/renderer/src/components/server/ServerGrid/ServerRegisters/AddRegister`. Expected: the new cases fail.

- [ ] **Step 5: Implement.**
  - `StartInput` copies `ValueInput`. `StepInput` uses `decimalMask(integer)` with `min` and `max` set to minus and plus the data type's span, so a negative step is typeable on an unsigned type.
  - The `valid` selector in `AddButtons` gets a ramp branch: `address`, `min`, `max`, `interval`, `start`, `step` all valid and `isRampFormValid`.
  - Start and Step show `error` when their own `valid` flag is false or `isRampFormValid` fails on that field.
  - The edit effect in `AddRegister.tsx` sets `generatorMode`, `start`, `step`, `restart` before `capturePristine`, with defaults for a register that carries none.
  - The checkbox is `@mui/material/Checkbox` inside `@mui/material/FormControlLabel`, label `Restart`.

- [ ] **Step 6: Run** the same command, then `yarn test src/__tests__/conformance.test.ts`. Expected: PASS.
- [ ] **Step 7: Commit** `feat: add ramp mode to the add register dialog`

---

### Task 5: MCP point tables

**Files:**
- Modify: `src/shared/pointTable.ts` (`PointGeneratorSchema`, `ResolvedGenerator`, `serverValue`, `serverRegisterParams`)
- Modify: `src/main/modules/mcp/tools/serverPoints.ts` (the `generator` row of `server_get_values`, both tool descriptions)
- Modify: `src/main/modules/mcp/prompts.ts`, `docs/mcp.md`
- Test: `src/shared/__tests__/pointTable.test.ts`, `src/main/modules/mcp/__tests__/pointTableTools.test.ts`, `src/main/modules/mcp/__tests__/prompts.test.ts`, `src/__tests__/pointTableCommands.test.ts`

**Interfaces:**
- Consumes: `GeneratorModeSchema` (Task 1).
- Produces: `PointGeneratorSchema` gains `mode: GeneratorModeSchema.optional()`, `start`, `step` (`z.number().optional()`), `restart: z.boolean().optional()`, each with a `.describe` in engineering units.
- Produces: `ResolvedGenerator` gains `mode?: 'ramp'`, `start?: number`, `step?: number`, `restart?: boolean`, in raw values.
- Produces: the `generator` object of a `server_get_values` row gains the same four keys for a ramp and is unchanged for a random generator.

Reject reasons, exact:
- `A ramp needs a start, a step, a min and a max`
- `A ${dataType} generator reads the clock and cannot ramp`
- `Ramp start: ${reason}` (from `engineeringToRaw`)
- `Ramp step: ${reason}` (from `engineeringToRaw(start + step)`)
- `The ramp step is 0 after scaling`
- `The ramp start has to be between its min and max`
- `start, step and restart belong to a ramp; set mode to "ramp"`

- [ ] **Step 1: Write the failing `pointTable.test.ts` cases** on a `uint16` holding register:

  - `{ mode: 'ramp', start: 0, step: 1, min: 0, max: 100 }` resolves to `{ min: 0, max: 100, intervalMs: 1000, mode: 'ramp', start: 0, step: 1, restart: true }`
  - with `scalingFactor: 0.1` and `{ start: 80, step: -0.5, min: 20, max: 80 }`: raw `start: 800, step: -5, min: 200, max: 800`
  - with `scalingFactor: -1` on `int16` and `{ start: 10, step: 1, min: 1, max: 50 }`: raw `start: -10, step: -1, min: -50, max: -1`
  - with `scalingFactor: 10` and `step: 1`: rejected, and the reason starts with `Ramp step:`
  - `step: 0`: rejected with `The ramp step is 0 after scaling`
  - each remaining reject reason above, one case each
  - `{ min: 0, max: 10 }` with no `mode` resolves exactly as it does today
  - `serverRegisterParams` of a resolved ramp passes `RegisterParamsSchema.safeParse`

- [ ] **Step 2: Write the failing tool cases** (`pointTableTools.test.ts`):

  - `server_get_values` on a stored ramp register answers `generator: { min, max, intervalMs, mode: 'ramp', start, step, restart }`
  - `server_set_values` on a ramp register answers `The register at 6 is driven by a generator; apply a point table to fix its value`, matching the existing case
  - `server_apply_point_table` with `dryRun: true` reports a ramp point accepted

- [ ] **Step 3: Run** `yarn test src/shared/__tests__/pointTable.test.ts src/main/modules/mcp src/__tests__/pointTableCommands.test.ts`. Expected: the new cases fail.

- [ ] **Step 4: Implement.** In `serverValue`, raw step is `engineeringToRaw(start + step).raw - engineeringToRaw(start).raw`. `min` and `max` keep the lowest-first ordering already there. Update the two tool descriptions and the step in `prompts.ts` that chooses between a fixed value and a generator: a quantity that accumulates, such as energy, takes `generator: { mode: 'ramp', start, step, min, max, intervalSeconds, restart }`. Update the `point_table_to_simulator` line in `docs/mcp.md`. Adjust `prompts.test.ts` to whatever it asserts about that text.

- [ ] **Step 5: Run** the same command. Expected: PASS.
- [ ] **Step 6: Commit** `feat: set and read ramp generators over mcp`

---

### Task 6: e2e, manual and changelog

**Files:**
- Create: `e2e/specs/01-main/44-ramp-generator.spec.ts`
- Modify: `e2e/specs/03-presentation/01-feature-tour.spec.ts` (one scene after `scene 9 — add register: FLOAT generator`, screenshot `add-register-uint16-ramp.png`)
- Modify: `docs/manual/README.md` (the section `固定值（Fixed）與隨機產生器（Generator）`), `CHANGELOG.md` under `[Unreleased]`

**Interfaces:**
- Consumes: the four `data-testid`s (Task 4).

- [ ] **Step 1: Write the spec**, starting with a `beforeAll` that calls `resetApp`, using `e2e/fixtures/helpers.ts`. Read `08-polling-generators.spec.ts` for how a server register is added and polled.

  - add a `uint16` holding register at address 0 in Ramp mode: start 5, step 1, min 0, max 7, interval 1, restart checked
  - connect the client, start polling, and assert with `expectCell` inside `toPass` that the cell reaches `7` and then `5`
  - edit the register: the dialog opens with `add-reg-ramp-btn` pressed, start `5`, step `1`
  - uncheck restart and save; assert the cell reaches `7`, wait two intervals, and assert it is still `7`

- [ ] **Step 2: Run** `yarn test:e2e e2e/specs/01-main/44-ramp-generator.spec.ts`. Expected: PASS. Run it three times in a row; all three pass.
- [ ] **Step 3: Add the presentation scene**, run `yarn presentation`, and confirm `docs/manual/images/add-register-uint16-ramp.png` exists and shows the Ramp fields.
- [ ] **Step 4: Update the manual** in Traditional Chinese, matching the section's tables: the Ramp column with its screenshot, and rows for Start, Step, Restart. State that Step is negative to decrease, that the value returns to Start on passing Min or Max, and that with Restart off it holds.
- [ ] **Step 5: Add the CHANGELOG entry** under `[Unreleased]`, one entry, saying what a user can now do in the window and over MCP.
- [ ] **Step 6: Run** `yarn verify`. Expected: exit 0.
- [ ] **Step 7: Commit** `test: cover ramp registers end to end` and `docs: describe ramp registers`
