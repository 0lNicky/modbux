import BugReport from '@mui/icons-material/BugReport'
import Button from '@mui/material/Button'
import { meme } from '@renderer/components/shared/inputs/meme'
import { useServerFaultsZustand } from '@renderer/context/serverFaults.zustand'
import { useServerZustand } from '@renderer/context/server.zustand'
import { useCallback } from 'react'
import ServerFaultsDialog from './ServerFaultsDialog'
import { useServerFaultsDialogZustand } from './serverFaultsDialog.zustand'

/**
 * The button that opens the fault rules of the shown server. Always drawn: the
 * rules are the fallback for when no AI can set them over MCP, so a server with
 * none has to offer a way to add one.
 *
 * With rules it counts them in the warning color, because a server with rules
 * answers masters differently from what its registers say.
 */
const ServerFaultsIndicator = meme(() => {
  const selectedUuid = useServerZustand((z) => z.selectedUuid)
  const ruleCount = useServerFaultsZustand((z) => z.rules[selectedUuid]?.length ?? 0)

  const openDialog = useCallback((): void => {
    useServerFaultsDialogZustand.getState().show(selectedUuid)
  }, [selectedUuid])

  return (
    <>
      <Button
        data-testid="server-faults-indicator"
        size="small"
        variant={ruleCount === 0 ? 'outlined' : 'contained'}
        color={ruleCount === 0 ? 'inherit' : 'warning'}
        startIcon={<BugReport />}
        onClick={openDialog}
      >
        {ruleCount === 0
          ? 'Fault rules'
          : ruleCount === 1
            ? '1 fault rule'
            : `${ruleCount} fault rules`}
      </Button>
      <ServerFaultsDialog />
    </>
  )
})

export default ServerFaultsIndicator
