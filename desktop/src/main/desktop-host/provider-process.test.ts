import { describe, expect, it, vi } from 'vitest'

describe('Provider process supervisor', () => {
  it('terminates only an owned process', async () => {
    const { ProviderProcessSupervisor } = await import('./provider-process.js')
    let nextPid = 100
    const terminate = vi.fn(async (_pid: number) => undefined)
    const supervisor = new ProviderProcessSupervisor({
      detectExecutable: async (path: string) => path.endsWith('codex.exe'),
      start: async () => ({ pid: nextPid++ }),
      terminate,
    })

    await supervisor.start('started', {
      executablePath: 'C:\\tools\\codex.exe',
      args: ['app-server'],
    })
    await supervisor.adopt('adopted', { pid: 200, executablePath: 'C:\\tools\\codex.exe' })
    await supervisor.connect('external', {
      pid: 300,
      executablePath: 'C:\\tools\\codex.exe',
    })
    expect(supervisor.status('started')).toEqual({
      executable: 'detected',
      process: 'running',
      transport: 'disconnected',
      session: 'unavailable',
      ownership: 'started',
    })
    supervisor.reportTransport('started', true)
    supervisor.reportSession('started', true)
    expect(supervisor.status('started')).toMatchObject({
      process: 'running',
      transport: 'ready',
      session: 'ready',
    })

    await supervisor.shutdown()
    expect(terminate).toHaveBeenCalledTimes(2)
    expect(terminate).toHaveBeenCalledWith(100)
    expect(terminate).toHaveBeenCalledWith(200)
    expect(terminate).not.toHaveBeenCalledWith(300)
    expect(supervisor.status('external')).toMatchObject({
      process: 'running',
      ownership: 'external',
    })
  })
})
