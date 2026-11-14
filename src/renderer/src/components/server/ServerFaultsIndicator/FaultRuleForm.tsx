import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import DialogActions from '@mui/material/DialogActions'
import FormControl from '@mui/material/FormControl'
import FormHelperText from '@mui/material/FormHelperText'
import InputLabel from '@mui/material/InputLabel'
import MenuItem from '@mui/material/MenuItem'
import Select from '@mui/material/Select'
import TextField from '@mui/material/TextField'
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import Typography from '@mui/material/Typography'
import { meme } from '@renderer/components/shared/inputs/meme'
import { FAULT_DELAY_MAX_MS, FAULT_FOR_SECONDS_MAX, RegisterTypeSchema } from '@shared'
import { useCallback, useMemo } from 'react'
import { ruleFromDraft, type FaultRuleDraft, type FaultRuleField } from './faultRule'
import { useServerFaultsDialogZustand, writeBlocked } from './serverFaultsDialog.zustand'

/** The errors of the draft in the store, by field. One place, so every field reads the same ones. */
const useErrors = (): ReturnType<typeof ruleFromDraft> => {
  const draft = useServerFaultsDialogZustand((z) => z.draft)
  return useMemo(() => ruleFromDraft(draft), [draft])
}

interface TextFieldProps {
  field: FaultRuleField
  draftKey: 'unitId' | 'code' | 'ms' | 'everyNth' | 'forSeconds'
  label: string
  testId: string
  hint: string
}

/** A number field. Left empty it means "any" or "no limit", except where the action needs it. */
const NumberField = meme(({ field, draftKey, label, testId, hint }: TextFieldProps) => {
  const value = useServerFaultsDialogZustand((z) => z.draft[draftKey])
  const { errors } = useErrors()

  const change = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>): void => {
      useServerFaultsDialogZustand.getState().setDraft({ [draftKey]: event.target.value })
    },
    [draftKey]
  )

  return (
    <TextField
      size="small"
      label={label}
      value={value}
      onChange={change}
      error={errors?.[field] !== undefined}
      helperText={errors?.[field] ?? hint}
      slotProps={{ htmlInput: { 'data-testid': testId, inputMode: 'numeric' } }}
    />
  )
})

//
//
// Conditions
const AddressRange = meme(() => {
  const start = useServerFaultsDialogZustand((z) => z.draft.addressStart)
  const end = useServerFaultsDialogZustand((z) => z.draft.addressEnd)
  const { errors } = useErrors()

  const changeStart = useCallback((event: React.ChangeEvent<HTMLInputElement>): void => {
    useServerFaultsDialogZustand.getState().setDraft({ addressStart: event.target.value })
  }, [])
  const changeEnd = useCallback((event: React.ChangeEvent<HTMLInputElement>): void => {
    useServerFaultsDialogZustand.getState().setDraft({ addressEnd: event.target.value })
  }, [])

  return (
    <Box sx={{ display: 'flex', gap: 1 }}>
      <TextField
        size="small"
        label="Address from"
        value={start}
        onChange={changeStart}
        error={errors?.addressRange !== undefined}
        helperText={errors?.addressRange ?? 'Empty: any address'}
        slotProps={{
          htmlInput: { 'data-testid': 'fault-form-address-start', inputMode: 'numeric' }
        }}
      />
      <TextField
        size="small"
        label="Address to"
        value={end}
        onChange={changeEnd}
        error={errors?.addressRange !== undefined}
        helperText="Included"
        slotProps={{ htmlInput: { 'data-testid': 'fault-form-address-end', inputMode: 'numeric' } }}
      />
    </Box>
  )
})

const RegisterTypeSelect = meme(() => {
  const value = useServerFaultsDialogZustand((z) => z.draft.registerType)

  const change = useCallback((next: FaultRuleDraft['registerType']): void => {
    useServerFaultsDialogZustand.getState().setDraft({ registerType: next })
  }, [])

  return (
    <FormControl size="small" sx={{ minWidth: 200 }}>
      <InputLabel id="fault-form-register-type-label">Register type</InputLabel>
      <Select
        labelId="fault-form-register-type-label"
        label="Register type"
        value={value}
        onChange={(event) => change(event.target.value as FaultRuleDraft['registerType'])}
        data-testid="fault-form-register-type"
      >
        <MenuItem value="">Any</MenuItem>
        {RegisterTypeSchema.options.map((type) => (
          <MenuItem key={type} value={type}>
            {type}
          </MenuItem>
        ))}
      </Select>
    </FormControl>
  )
})

const DirectionSelect = meme(() => {
  const value = useServerFaultsDialogZustand((z) => z.draft.direction)

  const change = useCallback((next: FaultRuleDraft['direction']): void => {
    useServerFaultsDialogZustand.getState().setDraft({ direction: next })
  }, [])

  return (
    <FormControl size="small" sx={{ minWidth: 140 }}>
      <InputLabel id="fault-form-direction-label">Direction</InputLabel>
      <Select
        labelId="fault-form-direction-label"
        label="Direction"
        value={value}
        onChange={(event) => change(event.target.value as FaultRuleDraft['direction'])}
        data-testid="fault-form-direction"
      >
        <MenuItem value="">Any</MenuItem>
        <MenuItem value="read">Read</MenuItem>
        <MenuItem value="write">Write</MenuItem>
      </Select>
    </FormControl>
  )
})

//
//
// Action
const ActionKind = meme(() => {
  const kind = useServerFaultsDialogZustand((z) => z.draft.actionKind)

  const change = useCallback((_event: unknown, next: FaultRuleDraft['actionKind'] | null): void => {
    if (next !== null) useServerFaultsDialogZustand.getState().setDraft({ actionKind: next })
  }, [])

  return (
    <ToggleButtonGroup size="small" exclusive color="primary" value={kind} onChange={change}>
      <ToggleButton value="exception" data-testid="fault-form-action-exception">
        Exception
      </ToggleButton>
      <ToggleButton value="no_response" data-testid="fault-form-action-no-response">
        No response
      </ToggleButton>
      <ToggleButton value="delay" data-testid="fault-form-action-delay">
        Delay
      </ToggleButton>
    </ToggleButtonGroup>
  )
})

const ActionDetail = meme(() => {
  const kind = useServerFaultsDialogZustand((z) => z.draft.actionKind)

  if (kind === 'exception')
    return (
      <NumberField
        field="code"
        draftKey="code"
        label="Exception code"
        testId="fault-form-code"
        hint="1 to 255, 6 is Server Device Busy"
      />
    )
  if (kind === 'delay')
    return (
      <NumberField
        field="ms"
        draftKey="ms"
        label="Delay (ms)"
        testId="fault-form-ms"
        hint={`1 to ${FAULT_DELAY_MAX_MS}`}
      />
    )
  return <FormHelperText>The server answers nothing, and a write stores nothing.</FormHelperText>
})

//
//
// Save, cancel
const FormActions = meme(() => {
  const { rule } = useErrors()
  const blocked = useServerFaultsDialogZustand(writeBlocked)

  const save = useCallback((): void => {
    void useServerFaultsDialogZustand.getState().save()
  }, [])
  const cancel = useCallback((): void => {
    useServerFaultsDialogZustand.getState().cancelEdit()
  }, [])

  return (
    <DialogActions>
      <Button data-testid="fault-form-cancel-btn" onClick={cancel}>
        Cancel
      </Button>
      <Button
        data-testid="fault-form-save-btn"
        variant="contained"
        disabled={!rule || blocked}
        onClick={save}
      >
        Save
      </Button>
    </DialogActions>
  )
})

const GoneNotice = meme(() => {
  const gone = useServerFaultsDialogZustand((z) => z.gone)
  if (!gone) return null
  return (
    <Typography data-testid="fault-form-gone" color="warning.main" variant="body2">
      This rule no longer exists. Saving adds it as a new rule.
    </Typography>
  )
})

/** The one form for adding and editing a rule: every field of `ServerFaultRuleSchema`. */
const FaultRuleForm = meme(() => {
  const isNew = useServerFaultsDialogZustand((z) => z.editing === 'new')

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
      <Typography variant="subtitle1">{isNew ? 'Add rule' : 'Edit rule'}</Typography>
      <GoneNotice />
      <Typography variant="body2" color="text.secondary">
        A request must match every condition. Empty means any.
      </Typography>
      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <NumberField
          field="unitId"
          draftKey="unitId"
          label="Unit ID"
          testId="fault-form-unit-id"
          hint="Empty: any unit"
        />
        <RegisterTypeSelect />
        <DirectionSelect />
        <AddressRange />
      </Box>
      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <ActionKind />
        <ActionDetail />
      </Box>
      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <NumberField
          field="everyNth"
          draftKey="everyNth"
          label="Every Nth match"
          testId="fault-form-every-nth"
          hint="Empty: every match"
        />
        <NumberField
          field="forSeconds"
          draftKey="forSeconds"
          label="For seconds"
          testId="fault-form-for-seconds"
          hint={`Empty: until removed. At most ${FAULT_FOR_SECONDS_MAX}`}
        />
      </Box>
      <FormActions />
    </Box>
  )
})

export default FaultRuleForm
