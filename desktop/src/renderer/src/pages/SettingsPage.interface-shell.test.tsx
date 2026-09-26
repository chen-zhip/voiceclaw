// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { SettingsPage } from './SettingsPage'
import { installRendererTestBoundaries } from '../test/renderer-test-boundaries'

afterEach(cleanup)

describe('SettingsPage interface shell', () => {
  it('keeps settings controls in grouped sections', async () => {
    installRendererTestBoundaries({
      settings: {
        voice_mode: 'stt-tts-harness',
        harness_provider_id: 'codex',
      },
    })

    render(<SettingsPage />)
    const surface = await screen.findByRole('region', { name: 'VoiceClaw settings' })
    expect(within(surface).getByRole('heading', { name: 'Settings' })).toBeTruthy()
    expect(within(surface).getByRole('heading', { name: 'Appearance' })).toBeTruthy()
    expect(within(surface).getByRole('heading', { name: 'Voice Model' })).toBeTruthy()
    expect(within(surface).getByRole('heading', { name: 'Audio Devices' })).toBeTruthy()

    fireEvent.click(within(surface).getByRole('button', { name: 'dark' }))
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('dark'))

    const providerId = await within(surface).findByRole('textbox', { name: 'Provider ID' })
    fireEvent.change(providerId, { target: { value: 'desktop-provider' } })
    await waitFor(() =>
      expect(window.electronAPI.db.setSetting).toHaveBeenCalledWith(
        'harness_provider_id',
        'desktop-provider'
      )
    )

    const microphone = within(surface).getByRole('combobox', { name: 'Input microphone' })
    fireEvent.change(microphone, { target: { value: '' } })
    await waitFor(() =>
      expect(window.electronAPI.db.setSetting).toHaveBeenCalledWith('input_device_id', '')
    )
  })
})
