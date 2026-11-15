import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Typography from '@mui/material/Typography'
import { meme } from '@renderer/components/shared/inputs/meme'
import { MAX_FAULT_RULES } from '@shared'
import { useCallback } from 'react'
import FaultRuleForm from './FaultRuleForm'
import FaultRuleRow from './FaultRuleRow'
import { useServerFaultsDialogZustand, writeBlocked } from './serverFaultsDialog.zustand'

//
//
// Why the last write did not happen
const WriteError = meme(() => {
  const error = useServerFaultsDialogZustand((z) => z.error)
  if (error === undefined) return null
  return (
    <Typography data-testid="server-faults-error" color="error" variant="body2" sx={{ mb: 1 }}>
      {error}
    </Typography>
  )
})

//
//
// The rules, in the order they are tried
const RuleList = meme(() => {
  const ruleCount = useServerFaultsDialogZustand((z) => z.status.length)

  return (
    <>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        Every change replaces the whole list: all counts and “for seconds” clocks start over.
      </Typography>
      {ruleCount === 0 ? (
        <Typography data-testid="server-faults-empty" sx={{ py: 2 }}>
          No fault rules. This server answers as its registers say.
        </Typography>
      ) : (
        Array.from({ length: ruleCount }, (_, index) => <FaultRuleRow key={index} index={index} />)
      )}
    </>
  )
})

//
//
// Add, refresh, clear all
const ListActions = meme(() => {
  const ruleCount = useServerFaultsDialogZustand((z) => z.status.length)
  const blocked = useServerFaultsDialogZustand(writeBlocked)

  const add = useCallback((): void => {
    useServerFaultsDialogZustand.getState().edit('new')
  }, [])
  const refresh = useCallback((): void => {
    void useServerFaultsDialogZustand.getState().refresh()
  }, [])
  const clearAll = useCallback((): void => {
    void useServerFaultsDialogZustand.getState().clearAll()
  }, [])
  const close = useCallback((): void => {
    useServerFaultsDialogZustand.getState().close()
  }, [])

  return (
    <DialogActions sx={{ justifyContent: 'space-between' }}>
      <div>
        <Button
          data-testid="server-faults-add-btn"
          disabled={blocked || ruleCount >= MAX_FAULT_RULES}
          onClick={add}
        >
          Add rule
        </Button>
        <Button data-testid="server-faults-refresh-btn" onClick={refresh}>
          Refresh
        </Button>
        <Button
          data-testid="server-faults-clear-all-btn"
          color="warning"
          disabled={ruleCount === 0}
          onClick={clearAll}
        >
          Clear all
        </Button>
      </div>
      <Button data-testid="server-faults-close-btn" onClick={close}>
        Close
      </Button>
    </DialogActions>
  )
})

const ServerFaultsDialog = meme(() => {
  const open = useServerFaultsDialogZustand((z) => z.open)
  const editing = useServerFaultsDialogZustand((z) => z.editing !== undefined)

  const close = useCallback((): void => {
    useServerFaultsDialogZustand.getState().close()
  }, [])

  return (
    <Dialog open={open} onClose={close} maxWidth="md" fullWidth data-testid="server-faults-dialog">
      <DialogTitle>Fault rules</DialogTitle>
      <DialogContent>
        <WriteError />
        {editing ? <FaultRuleForm /> : <RuleList />}
      </DialogContent>
      {!editing && <ListActions />}
    </Dialog>
  )
})

export default ServerFaultsDialog
