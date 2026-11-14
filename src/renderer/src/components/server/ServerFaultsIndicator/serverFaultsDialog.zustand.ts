/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { create } from 'zustand'
import { mutative } from 'zustand-mutative'
import type { ServerFaultRuleStatus } from '@shared'
import { onEvent } from '@renderer/events'
import {
  draftFromRule,
  emptyDraft,
  moveRule,
  ruleFromDraft,
  ruleOfStatus,
  type FaultRuleDraft
} from './faultRule'

/** Which rule the form is editing: a place in the list, or a rule not in it yet. */
export type EditingFaultRule = number | 'new'

interface ServerFaultsDialogZustand {
  open: boolean
  /** The server the dialog was opened for, which stays put while it is open. */
  uuid: string
  /** What `get_server_fault_status` last answered for `uuid`, in order. */
  status: ServerFaultRuleStatus[]
  /** When `status` arrived, which `expiresAt` is measured against. */
  fetchedAt: number
  /** Undefined while the list is shown. */
  editing: EditingFaultRule | undefined
  draft: FaultRuleDraft
  show: (uuid: string) => void
  close: () => void
  refresh: () => Promise<void>
  edit: (editing: EditingFaultRule) => void
  cancelEdit: () => void
  setDraft: (patch: Partial<FaultRuleDraft>) => void
  save: () => Promise<void>
  move: (index: number, step: -1 | 1) => Promise<void>
  remove: (index: number) => Promise<void>
  clearAll: () => Promise<void>
}

/**
 * The newest status request. A reply writes only while it is still the newest,
 * so one that is overtaken, by a `server_faults` event that asked again or by
 * the dialog closing, is dropped instead of putting an older list on screen.
 */
let latestRequest = 0

export const useServerFaultsDialogZustand = create<
  ServerFaultsDialogZustand,
  [['zustand/mutative', never]]
>(
  mutative((set, get) => {
    /** The list main holds as `status` last said it, which every write sends back whole. */
    const currentRules = () => get().status.map(ruleOfStatus)

    const replaceWith = async (rules: ReturnType<typeof currentRules>) => {
      // `server_faults` follows the write and asks for the status again.
      await window.api.setServerFaults({ uuid: get().uuid, rules })
    }

    return {
      open: false,
      uuid: '',
      status: [],
      fetchedAt: 0,
      editing: undefined,
      draft: emptyDraft,
      show: (uuid) => {
        set((state) => {
          state.open = true
          state.uuid = uuid
          state.status = []
          state.editing = undefined
        })
        void get().refresh()
      },
      close: () => {
        latestRequest += 1
        set((state) => {
          state.open = false
          state.editing = undefined
        })
      },
      refresh: async () => {
        latestRequest += 1
        const request = latestRequest
        const status = await window.api.getServerFaultStatus(get().uuid)
        if (request !== latestRequest) return
        set((state) => {
          state.status = status
          state.fetchedAt = Date.now()
        })
      },
      edit: (editing) =>
        set((state) => {
          state.editing = editing
          const rule = editing === 'new' ? undefined : state.status[editing]
          state.draft = rule === undefined ? emptyDraft : draftFromRule(ruleOfStatus(rule))
        }),
      cancelEdit: () =>
        set((state) => {
          state.editing = undefined
        }),
      setDraft: (patch) =>
        set((state) => {
          Object.assign(state.draft, patch)
        }),
      save: async () => {
        const { editing, draft } = get()
        const { rule } = ruleFromDraft(draft)
        if (editing === undefined || rule === undefined) return
        const rules = currentRules()
        await replaceWith(
          editing === 'new' ? [...rules, rule] : rules.map((old, i) => (i === editing ? rule : old))
        )
        set((state) => {
          state.editing = undefined
        })
      },
      move: (index, step) => replaceWith(moveRule(currentRules(), index, step)),
      remove: (index) => replaceWith(currentRules().filter((_, i) => i !== index)),
      clearAll: () => window.api.clearServerFaults(get().uuid)
    }
  })
)

onEvent('server_faults', ({ uuid }) => {
  const dialog = useServerFaultsDialogZustand.getState()
  if (dialog.open && dialog.uuid === uuid) void dialog.refresh()
})
