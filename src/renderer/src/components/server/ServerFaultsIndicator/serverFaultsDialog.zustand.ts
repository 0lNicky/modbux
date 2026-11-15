/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { create } from 'zustand'
import { mutative } from 'zustand-mutative'
import {
  MAX_FAULT_RULES,
  SetServerFaultsParamsSchema,
  type ServerFaultRule,
  type ServerFaultRuleStatus,
  type ServerFaultStatus
} from '@shared'
import { onEvent } from '@renderer/events'
import {
  draftFromRule,
  emptyDraft,
  findEditedRule,
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
  /** The newest list main answered for `uuid`, in order. */
  status: ServerFaultRuleStatus[]
  /** The version of `status`, which a write sends back. */
  version: number
  /**
   * A status request is out, so `status` may be older than main's list. `show`
   * sends one, so this is true until the first answer arrives.
   */
  loading: boolean
  /** A write is out, and the list it leaves is not known yet. */
  writing: boolean
  /** Main's last answer said it no longer has the server, which takes no rules. */
  deleted: boolean
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
  /** Where the form was opened on `target`, which wins while that place still holds it. */
  targetIndex: number | undefined
  /** The target can no longer be found in the list main holds. */
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

/**
 * Which dialog and form a write belongs to. Opening, closing, picking a rule
 * and cancelling all start a new one, and a write's reply that finds a newer
 * one changes nothing on screen: the form or the error there is not its own.
 */
let generation = 0

/** The newest write. A reply clears `writing` only while it is still the newest. */
let latestWrite = 0

/**
 * Whether a write would be built from a list main may no longer hold: while a
 * status request is out, the first one included, or while another write is.
 * Or whether main would refuse it for a server it no longer has. `replaceWith`
 * sends nothing then, and the buttons that write are disabled.
 */
export const writeBlocked = (z: {
  loading: boolean
  writing: boolean
  deleted: boolean
}): boolean => z.loading || z.writing || z.deleted

const DELETED = 'This server was deleted, so its fault rules cannot be changed.'

/** The message a write main refused as stale leaves on screen. */
const STALE_WRITE =
  'The rules changed before this write reached main, so nothing was written. The list shows the rules main holds now.'

export const useServerFaultsDialogZustand = create<
  ServerFaultsDialogZustand,
  [['zustand/mutative', never]]
>(
  mutative((set, get) => {
    /** The list main holds as `status` last said it, which every write sends back whole. */
    const currentRules = () => get().status.map(ruleOfStatus)

    /**
     * Puts the list main answered on screen, with the version a write sends back.
     * An answer for a server main no longer has closes the form and drops its
     * draft, because no save can take it.
     */
    const showStatus = (answer: ServerFaultStatus) => {
      if (!answer.exists) generation += 1
      set((state) => {
        if (!answer.exists) {
          state.editing = undefined
          state.draft = emptyDraft
          state.error = DELETED
        } else if (state.deleted) {
          state.error = undefined
        }
        state.deleted = !answer.exists
        state.status = answer.rules
        state.version = answer.version
        state.fetchedAt = Date.now()
        state.gone =
          state.editing === 'existing' &&
          editedAt(answer.rules, state.target, state.targetIndex) === -1
      })
    }

    /**
     * Sends `rules`, built from `status`, with the version of `status`, and says
     * whether main took them.
     *
     * Nothing is sent while `writeBlocked` holds, because `status` may then be
     * older than main's list. A list the schema refuses is not sent, and a
     * refusal keeps its reason for the screen. Main answers the list it holds
     * after the write, taken or not, and that list is shown.
     */
    const replaceWith = async (rules: ServerFaultRule[]): Promise<boolean> => {
      const { uuid, version } = get()
      if (writeBlocked(get())) return false
      const params = { uuid, version, rules }
      const startedIn = generation
      const refusal = (message: string): false => {
        if (startedIn === generation) {
          set((state) => {
            state.error = message
          })
        }
        return false
      }
      if (rules.length > MAX_FAULT_RULES) {
        return refusal(`A server takes at most ${MAX_FAULT_RULES} rules`)
      }
      const parsed = SetServerFaultsParamsSchema.safeParse(params)
      if (!parsed.success) return refusal(parsed.error.issues[0]?.message ?? 'Invalid rules')

      latestWrite += 1
      const write = latestWrite
      set((state) => {
        state.writing = true
      })
      const answer = await window.api.setServerFaults(parsed.data)
      if (write === latestWrite) {
        set((state) => {
          state.writing = false
        })
      }
      // A taken write is taken wherever the screen is now, but only its own
      // dialog hears about it.
      if (startedIn !== generation) return false
      if (answer === undefined) return refusal('Main refused the rules, so nothing changed')
      showStatus(answer.status)
      if (!answer.taken) return refusal(STALE_WRITE)
      set((state) => {
        state.error = undefined
      })
      return true
    }

    /** Where the edited rule is in `status`, as `findEditedRule` reads it. */
    const editedAt = (
      status: ServerFaultRuleStatus[],
      target: ServerFaultRule | undefined,
      openedAt: number | undefined
    ) => findEditedRule(status.map(ruleOfStatus), target, openedAt)

    return {
      open: false,
      uuid: '',
      status: [],
      version: 0,
      loading: false,
      writing: false,
      deleted: false,
      fetchedAt: 0,
      editing: undefined,
      target: undefined,
      targetIndex: undefined,
      gone: false,
      error: undefined,
      draft: emptyDraft,
      show: (uuid) => {
        generation += 1
        set((state) => {
          state.open = true
          state.uuid = uuid
          state.status = []
          state.version = 0
          state.writing = false
          state.editing = undefined
          state.error = undefined
        })
        void get().refresh()
      },
      close: () => {
        latestRequest += 1
        generation += 1
        set((state) => {
          state.open = false
          state.editing = undefined
        })
      },
      refresh: async () => {
        latestRequest += 1
        const request = latestRequest
        set((state) => {
          state.loading = true
        })
        const answer = await window.api.getServerFaultStatus(get().uuid)
        if (request !== latestRequest) return
        set((state) => {
          state.loading = false
        })
        showStatus(answer)
      },
      edit: (index) => {
        generation += 1
        set((state) => {
          const row = index === 'new' ? undefined : state.status[index]
          state.editing = row === undefined ? 'new' : 'existing'
          state.target = row === undefined ? undefined : ruleOfStatus(row)
          state.targetIndex = row === undefined || index === 'new' ? undefined : index
          state.gone = false
          state.error = undefined
          state.draft = row === undefined ? emptyDraft : draftFromRule(ruleOfStatus(row))
        })
      },
      cancelEdit: () => {
        generation += 1
        set((state) => {
          state.editing = undefined
          state.error = undefined
        })
      },
      setDraft: (patch) =>
        set((state) => {
          Object.assign(state.draft, patch)
        }),
      save: async () => {
        const { editing, draft, target, targetIndex } = get()
        const { rule } = ruleFromDraft(draft)
        if (editing === undefined || rule === undefined) return
        const rules = currentRules()
        // The rule picked, found where it sits now. Gone, the draft is added.
        const at = editing === 'existing' ? findEditedRule(rules, target, targetIndex) : -1
        const taken = await replaceWith(
          at === -1 ? [...rules, rule] : rules.map((old, i) => (i === at ? rule : old))
        )
        // `replaceWith` answers true only for the form this save started in.
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
