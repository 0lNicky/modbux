/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { describe, it, expect, vi } from 'vitest'
import { presentWindow } from '../presentWindow'

const createMockWindow = () => ({
  show: vi.fn(),
  showInactive: vi.fn(),
  setOpacity: vi.fn(),
  setIgnoreMouseEvents: vi.fn(),
  setSkipTaskbar: vi.fn()
})

describe('presentWindow', () => {
  it('shows the window and takes the focus in the foreground', () => {
    const window = createMockWindow()

    presentWindow(window, false)

    expect(window.show).toHaveBeenCalledOnce()
    expect(window.showInactive).not.toHaveBeenCalled()
    expect(window.setOpacity).not.toHaveBeenCalled()
    expect(window.setIgnoreMouseEvents).not.toHaveBeenCalled()
    expect(window.setSkipTaskbar).not.toHaveBeenCalled()
  })

  it('shows an invisible, unclickable window without the focus in the background', () => {
    const window = createMockWindow()

    presentWindow(window, true)

    expect(window.show).not.toHaveBeenCalled()
    expect(window.setOpacity).toHaveBeenCalledWith(0)
    expect(window.setIgnoreMouseEvents).toHaveBeenCalledWith(true)
    expect(window.setSkipTaskbar).toHaveBeenCalledWith(true)
    expect(window.showInactive).toHaveBeenCalledOnce()
  })

  it('hides the window before it shows it', () => {
    const window = createMockWindow()

    presentWindow(window, true)

    const shownAt = window.showInactive.mock.invocationCallOrder[0] ?? 0
    expect(window.setOpacity.mock.invocationCallOrder[0]).toBeLessThan(shownAt)
    expect(window.setIgnoreMouseEvents.mock.invocationCallOrder[0]).toBeLessThan(shownAt)
  })
})
