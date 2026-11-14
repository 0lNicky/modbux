/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { create } from 'zustand'
import { mutative } from 'zustand-mutative'
import { deepEqual } from 'fast-equals'
import {
  MAX_FAULT_RULES,
  SetServerFaultsParamsSchema,
  type ServerFaultRule,
  type ServerFaultRuleStatus
} from '@shared'
import { onEvent } from '@renderer/events'
import {
  draftFromRule,
  emptyDraft,
  moveRule,
  ruleFromDraft,
  ruleOfStatus,
  type FaultRuleDraft
} from './faultRule'

/** What the form is for: a rule picked from the list, or a rule not in it yet. */
export type EditingFaultRule = 'existing' | 'new'

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
  /**
   * The rule the form was opened on, as it was then. A position would name a
   * different rule once main changes the list, so a save finds this rule
   * again instead.
   */
  target: ServerFaultRule | undefined
  /** The target is no longer in the list main holds. */
  gone: boolean
  /** Why the last write did not happen, until the next one does. */
  error: string | undefined
  draft: FaultRuleDraft
  show: (uuid: string) => void
  close: () => void
  refresh: () => Promise<void>
  /** Opens the form on the rule at `index` of the list shown, or on a new one. */
  edit: (index: number | 'new') => void
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

    /**
     * Sends `rules` and says whether main took them. A list the schema refuses is
     * not sent, and a reply that is not `true` is a refusal, so the reason is
     * kept for the screen. `server_faults` follows a taken write and asks for
     * the status again.
     */
    const replaceWith = async (rules: ServerFaultRule[]): Promise<boolean> => {
      const params = { uuid: get().uuid, rules }
      const refusal = (message: string): false => {
        set((state) => {
          state.error = message
        })
        return false
      }
      if (rules.length > MAX_FAULT_RULES) {
        return refusal(`A server takes at most ${MAX_FAULT_RULES} rules`)
      }
      const parsed = SetServerFaultsParamsSchema.safeParse(params)
      if (!parsed.success) return refusal(parsed.error.issues[0]?.message ?? 'Invalid rules')
      if ((await window.api.setServerFaults(parsed.data)) !== true) {
        return refusal('Main refused the rules, so nothing changed')
      }
      set((state) => {
        state.error = undefined
      })
      return true
    }

    /** Whether `target` is in the list `status` holds, equal rules being interchangeable. */
    const isListed = (status: ServerFaultRuleStatus[], target: ServerFaultRule | undefined) =>
      target !== undefined && status.some((row) => deepEqual(ruleOfStatus(row), target))

    return {
      open: false,
      uuid: '',
      status: [],
      fetchedAt: 0,
      editing: undefined,
      target: undefined,
      gone: false,
      error: undefined,
      draft: emptyDraft,
      show: (uuid) => {
        set((state) => {
          state.open = true
          state.uuid = uuid
          state.status = []
          state.editing = undefined
          state.error = undefined
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
          state.gone = state.editing === 'existing' && !isListed(status, state.target)
        })
      },
      edit: (index) =>
        set((state) => {
          const row = index === 'new' ? undefined : state.status[index]
          state.editing = row === undefined ? 'new' : 'existing'
          state.target = row === undefined ? undefined : ruleOfStatus(row)
          state.gone = false
          state.error = undefined
          state.draft = row === undefined ? emptyDraft : draftFromRule(ruleOfStatus(row))
        }),
      cancelEdit: () =>
        set((state) => {
          state.editing = undefined
          state.error = undefined
        }),
      setDraft: (patch) =>
        set((state) => {
          Object.assign(state.draft, patch)
        }),
      save: async () => {
        const { editing, draft, target } = get()
        const { rule } = ruleFromDraft(draft)
        if (editing === undefined || rule === undefined) return
        const rules = currentRules()
        // The rule picked, found where it sits now. Gone, the draft is added.
        const at = editing === 'existing' ? rules.findIndex((old) => deepEqual(old, target)) : -1
        const taken = await replaceWith(
          at === -1 ? [...rules, rule] : rules.map((old, i) => (i === at ? rule : old))
        )
        if (!taken) return
        set((state) => {
          state.editing = undefined
        })
      },
      move: async (index, step) => {
        await replaceWith(moveRule(currentRules(), index, step))
      },
      remove: async (index) => {
        await replaceWith(currentRules().filter((_, i) => i !== index))
      },
      clearAll: () => window.api.clearServerFaults(get().uuid)
    }
  })
)

onEvent('server_faults', ({ uuid }) => {
  const dialog = useServerFaultsDialogZustand.getState()
  if (dialog.open && dialog.uuid === uuid) void dialog.refresh()
})
