type Ownership = 'started' | 'adopted' | 'external'

type ProcessRecord = {
  pid: number
  executable: 'detected' | 'missing'
  process: 'running' | 'stopped' | 'failed'
  transport: 'disconnected' | 'ready'
  session: 'unavailable' | 'ready'
  ownership: Ownership
}

export class ProviderProcessError extends Error {
  constructor(
    readonly code: 'executable_not_found' | 'process_not_found',
    message: string
  ) {
    super(message)
    this.name = 'ProviderProcessError'
  }
}

export class ProviderProcessSupervisor {
  readonly #records = new Map<string, ProcessRecord>()

  constructor(
    private readonly boundary: {
      detectExecutable(path: string): Promise<boolean>
      start(input: { executablePath: string; args: string[] }): Promise<{ pid: number }>
      terminate(pid: number): Promise<void>
    }
  ) {}

  async start(
    providerId: string,
    input: { executablePath: string; args: string[] }
  ): Promise<void> {
    await this.#requireExecutable(input.executablePath)
    const process = await this.boundary.start(input)
    this.#records.set(providerId, createRecord(process.pid, 'started'))
  }

  async adopt(providerId: string, input: { pid: number; executablePath: string }): Promise<void> {
    await this.#requireExecutable(input.executablePath)
    this.#records.set(providerId, createRecord(input.pid, 'adopted'))
  }

  async connect(providerId: string, input: { pid: number; executablePath: string }): Promise<void> {
    await this.#requireExecutable(input.executablePath)
    this.#records.set(providerId, createRecord(input.pid, 'external'))
  }

  reportTransport(providerId: string, ready: boolean): void {
    const record = this.#record(providerId)
    record.transport = ready ? 'ready' : 'disconnected'
    if (!ready) record.session = 'unavailable'
  }

  reportSession(providerId: string, ready: boolean): void {
    const record = this.#record(providerId)
    record.session = ready ? 'ready' : 'unavailable'
  }

  status(providerId: string) {
    const { pid: _, ...status } = this.#record(providerId)
    return structuredClone(status)
  }

  async shutdown(): Promise<void> {
    for (const record of this.#records.values()) {
      if (record.process !== 'running' || record.ownership === 'external') continue
      await this.boundary.terminate(record.pid)
      record.process = 'stopped'
      record.transport = 'disconnected'
      record.session = 'unavailable'
    }
  }

  async #requireExecutable(path: string): Promise<void> {
    if (!(await this.boundary.detectExecutable(path))) {
      throw new ProviderProcessError(
        'executable_not_found',
        'Harness Provider executable is missing'
      )
    }
  }

  #record(providerId: string): ProcessRecord {
    const record = this.#records.get(providerId)
    if (!record) {
      throw new ProviderProcessError('process_not_found', 'Harness Provider process is unknown')
    }
    return record
  }
}

function createRecord(pid: number, ownership: Ownership): ProcessRecord {
  return {
    pid,
    executable: 'detected',
    process: 'running',
    transport: 'disconnected',
    session: 'unavailable',
    ownership,
  }
}
