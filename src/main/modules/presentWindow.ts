import type { BrowserWindow } from 'electron'

type PresentableWindow = Pick<
  BrowserWindow,
  'show' | 'showInactive' | 'setOpacity' | 'setIgnoreMouseEvents' | 'setSkipTaskbar'
>

/**
 * `E2E_BACKGROUND=1` keeps every window off the desktop of whoever runs the e2e
 * suite. The suite sets it in `e2e/fixtures/launch.ts`.
 */
export const runsInBackground = process.env.E2E_BACKGROUND === '1'

/**
 * Shows a window, or in the background shows one nobody sees or can click.
 *
 * `showInactive` leaves the focus where it was, opacity 0 hides the window on
 * macOS and Windows, and ignored mouse events let a click land on whatever is
 * behind it. Linux ignores the opacity; run under `xvfb-run` there.
 */
export function presentWindow(window: PresentableWindow, background = runsInBackground): void {
  if (!background) {
    window.show()
    return
  }
  window.setOpacity(0)
  window.setIgnoreMouseEvents(true)
  window.setSkipTaskbar(true)
  window.showInactive()
}
