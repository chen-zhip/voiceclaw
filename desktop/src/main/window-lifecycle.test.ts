import { beforeEach, describe, expect, it, vi } from 'vitest'

const electronState = vi.hoisted(() => ({ options: null as Record<string, unknown> | null }))

vi.mock('electron', () => {
  class BrowserWindow {
    webContents = {
      setWindowOpenHandler: vi.fn(),
      on: vi.fn(),
    }

    constructor(options: Record<string, unknown>) {
      electronState.options = options
    }

    on = vi.fn()
    loadFile = vi.fn()
    loadURL = vi.fn()
    isVisible = vi.fn(() => true)
    show = vi.fn()
    focus = vi.fn()
    hide = vi.fn()
  }

  return {
    app: { dock: undefined },
    BrowserWindow,
    shell: { openExternal: vi.fn() },
  }
})

vi.mock('./telemetry', () => ({ captureException: vi.fn() }))

import { createMainWindow } from './window-lifecycle'

describe('main window responsive bounds', () => {
  beforeEach(() => {
    electronState.options = null
  })

  it('allows the compact navigation breakpoint', () => {
    createMainWindow({ isDev: false })

    expect(electronState.options).not.toBeNull()
    expect(electronState.options?.minWidth).toBeLessThanOrEqual(760)
  })
})
