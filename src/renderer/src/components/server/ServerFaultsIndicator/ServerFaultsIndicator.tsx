import BugReport from '@mui/icons-material/BugReport'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import { meme } from '@renderer/components/shared/inputs/meme'
import { useServerFaultsZustand } from '@renderer/context/serverFaults.zustand'
import { useServerZustand } from '@renderer/context/server.zustand'
import { useCallback } from 'react'

/**
 * The fault rules the shown server answers with, counted, and the button that
 * removes them. Drawn only while there is at least one, because a server with
 * rules answers masters differently from what its registers say.
 *
 * The rules are set over MCP and live in main, so the clear goes to main and
 * the list comes back through `server_faults`.
 */
const ServerFaultsIndicator = meme(() => {
  const selectedUuid = useServerZustand((z) => z.selectedUuid)
  const ruleCount = useServerFaultsZustand((z) => z.rules[selectedUuid]?.length ?? 0)

  const clearFaults = useCallback((): void => {
    void window.api.clearServerFaults(selectedUuid)
  }, [selectedUuid])

  if (ruleCount === 0) return null

  return (
    <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
      <Chip
        data-testid="server-faults-indicator"
        icon={<BugReport />}
        color="warning"
        label={ruleCount === 1 ? '1 fault rule' : `${ruleCount} fault rules`}
        title="Fault rules set over MCP decide how this server answers"
      />
      <Button
        data-testid="server-faults-clear-btn"
        size="small"
        variant="outlined"
        color="warning"
        onClick={clearFaults}
      >
        Clear faults
      </Button>
    </Box>
  )
})

export default ServerFaultsIndicator
