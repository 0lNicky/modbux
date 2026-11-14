import ArrowDownward from '@mui/icons-material/ArrowDownward'
import ArrowUpward from '@mui/icons-material/ArrowUpward'
import Delete from '@mui/icons-material/Delete'
import Edit from '@mui/icons-material/Edit'
import Box from '@mui/material/Box'
import IconButton from '@mui/material/IconButton'
import Typography from '@mui/material/Typography'
import { meme } from '@renderer/components/shared/inputs/meme'
import { useCallback } from 'react'
import { describeFaultRule, ruleOfStatus, secondsLeft } from './faultRule'
import { useServerFaultsDialogZustand } from './serverFaultsDialog.zustand'

interface FaultRuleRowProps {
  /** The place in the list, which is the rule's priority. */
  index: number
}

/** One rule: what it does, what it has done, and the buttons that change the list. */
const FaultRuleRow = meme(({ index }: FaultRuleRowProps) => {
  const status = useServerFaultsDialogZustand((z) => z.status[index])
  const isLast = useServerFaultsDialogZustand((z) => index === z.status.length - 1)
  const fetchedAt = useServerFaultsDialogZustand((z) => z.fetchedAt)

  const moveUp = useCallback((): void => {
    void useServerFaultsDialogZustand.getState().move(index, -1)
  }, [index])
  const moveDown = useCallback((): void => {
    void useServerFaultsDialogZustand.getState().move(index, 1)
  }, [index])
  const edit = useCallback((): void => {
    useServerFaultsDialogZustand.getState().edit(index)
  }, [index])
  const remove = useCallback((): void => {
    void useServerFaultsDialogZustand.getState().remove(index)
  }, [index])

  if (!status) return null
  const testId = `server-faults-rule-${index}`

  return (
    <Box
      data-testid={testId}
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        py: 0.5,
        borderTop: 1,
        borderColor: 'divider'
      }}
    >
      <Typography sx={{ width: 24 }} color="text.secondary">
        {index + 1}
      </Typography>
      <Typography data-testid={`${testId}-summary`} sx={{ flex: 1 }}>
        {describeFaultRule(ruleOfStatus(status))}
      </Typography>
      <Typography data-testid={`${testId}-counts`} variant="body2" color="text.secondary">
        triggered {status.triggered} / matched {status.matched}
      </Typography>
      {status.expiresAt !== undefined && (
        <Typography data-testid={`${testId}-left`} variant="body2" color="text.secondary">
          {secondsLeft(status.expiresAt, fetchedAt)} s left
        </Typography>
      )}
      <IconButton
        data-testid={`${testId}-up`}
        aria-label="Move up"
        size="small"
        disabled={index === 0}
        onClick={moveUp}
      >
        <ArrowUpward fontSize="small" />
      </IconButton>
      <IconButton
        data-testid={`${testId}-down`}
        aria-label="Move down"
        size="small"
        disabled={isLast}
        onClick={moveDown}
      >
        <ArrowDownward fontSize="small" />
      </IconButton>
      <IconButton data-testid={`${testId}-edit`} aria-label="Edit" size="small" onClick={edit}>
        <Edit fontSize="small" />
      </IconButton>
      <IconButton
        data-testid={`${testId}-delete`}
        aria-label="Delete"
        size="small"
        onClick={remove}
      >
        <Delete fontSize="small" />
      </IconButton>
    </Box>
  )
})

export default FaultRuleRow
