import { describe, expect, it, vi } from 'vitest'
import { DesktopSettingsStorage } from './native-provider-configuration.js'

function storageWith(configurations: Array<Record<string, unknown>>) {
  const values = new Map<string, string>()
  for (const configuration of configurations) {
    values.set(
      `desktop-host:native-provider-configuration:${String(configuration.bindingId)}`,
      JSON.stringify(configuration)
    )
  }
  return new DesktopSettingsStorage({
    prepare: () => ({
      get: (key: string) => (values.has(key) ? { value: values.get(key) } : undefined),
      all: () => [...values.keys()].map((key) => ({ key })),
      run: (key: string, value: string) => values.set(key, value),
    }),
  })
}

const first = {
  providerId: 'codex',
  bindingId: 'binding-1',
  workspaceBindingId: 'workspace-1',
  workspacePath: 'C:\\workspaces\\first',
  executable: { path: 'C:\\tools\\codex.exe', args: ['app-server'] },
  preferences: { model: 'gpt-5-codex', approvalPolicy: 'never' },
  secretRefs: {},
}

const second = {
  ...first,
  bindingId: 'binding-2',
  workspaceBindingId: 'workspace-2',
}

describe('Desktop Host binding readiness', () => {
  it('reports each configured binding once, in a stable order', async () => {
    const { reportConfiguredBindingReadiness } = await import('./host-provider-context.js')
    const report = vi.fn(async () => undefined)

    const count = await reportConfiguredBindingReadiness({
      storage: storageWith([second, first]),
      report,
    })

    expect(count).toBe(2)
    expect(report.mock.calls.map(([binding]) => binding)).toEqual([
      { bindingId: 'binding-1', providerId: 'codex', workspaceBindingId: 'workspace-1' },
      { bindingId: 'binding-2', providerId: 'codex', workspaceBindingId: 'workspace-2' },
    ])
  })

  it('reports nothing when no binding is configured', async () => {
    const { reportConfiguredBindingReadiness } = await import('./host-provider-context.js')
    const report = vi.fn(async () => undefined)

    const count = await reportConfiguredBindingReadiness({
      storage: storageWith([{ bindingId: 'broken', providerId: 'codex' }]),
      report,
    })

    expect(count).toBe(0)
    expect(report).not.toHaveBeenCalled()
  })
})
