import { create } from 'zustand'
import type { ServerFaultRule } from '@shared'
import { onEvent } from '@renderer/events'

/**
 * The fault rules main holds, per server uuid.
 *
 * Main owns the rules and the MCP tools set them, so this is a copy: written
 * from `server_faults` on every change and from `get_server_faults` once, when
 * the window loads. Nothing here is persisted, because main forgets the rules
 * on a restart.
 */
export interface ServerFaultsZustand {
  rules: Record<string, ServerFaultRule[]>
}

export const useServerFaultsZustand = create<ServerFaultsZustand>()(() => ({ rules: {} }))

onEvent('server_faults', ({ uuid, rules }) => {
  useServerFaultsZustand.setState((z) => ({ rules: { ...z.rules, [uuid]: rules } }))
})

/**
 * Ask main for every server's rules. `server_faults` goes out on a change, so a
 * window that loads after the last one, or reloads, has heard none of them.
 */
const readServerFaults = async (): Promise<void> => {
  const rules = await window.api.getServerFaults()
  useServerFaultsZustand.setState({ rules })
}

void readServerFaults()
