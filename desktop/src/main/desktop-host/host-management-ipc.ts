export type HostManagementProjection = {
  hostId: string
  status: 'online' | 'offline' | 'revoked'
  lastActivityAt: string | null
}

export interface DesktopHostManagement {
  inspect(): Promise<HostManagementProjection[]>
  enroll(installationId: string): Promise<void>
  revoke(hostId: string): Promise<void>
  reregister(installationId: string): Promise<void>
}

export interface HostManagementIpcRegistrar {
  handle(channel: string, handler: (event: unknown, ...arguments_: any[]) => unknown): unknown
}

export function registerHostManagementIpc(
  ipc: HostManagementIpcRegistrar,
  management: DesktopHostManagement
): void {
  ipc.handle('desktop-host:status', () => management.inspect())
  ipc.handle('desktop-host:enroll', async (_event, installationId: string) => {
    await management.enroll(installationId)
    return { ok: true as const }
  })
  ipc.handle('desktop-host:revoke', async (_event, hostId: string) => {
    await management.revoke(hostId)
    return { ok: true as const }
  })
  ipc.handle('desktop-host:reregister', async (_event, installationId: string) => {
    await management.reregister(installationId)
    return { ok: true as const }
  })
}

export class RelayHostManagementClient implements DesktopHostManagement {
  constructor(
    private readonly options: {
      baseUrl(): string
      ownerCredential(): string
      credentialStore: {
        save(hostId: string, credential: string): Promise<void>
        clear(): Promise<void>
      }
      fetch?: typeof fetch
      credentialStored?(): Promise<void>
    }
  ) {}

  async inspect(): Promise<HostManagementProjection[]> {
    const response = await this.#request('/host/registrations')
    const body: unknown = await response.json()
    if (!Array.isArray(body)) throw new Error('invalid_host_management_response')
    return body.map(readProjection)
  }

  async revoke(hostId: string): Promise<void> {
    await this.#request(`/host/registrations/${encodeURIComponent(hostId)}/revoke`, {
      method: 'POST',
    })
    await this.options.credentialStore.clear()
  }

  async enroll(installationId: string): Promise<void> {
    await this.#completeEnrollment('/host/enrollment-tokens', installationId)
  }

  async reregister(installationId: string): Promise<void> {
    await this.#completeEnrollment('/host/reregistration-tokens', installationId)
  }

  async #completeEnrollment(path: string, installationId: string): Promise<void> {
    const issued = await this.#request(path, {
      method: 'POST',
      body: JSON.stringify({ installationId }),
    })
    const issuedBody = (await issued.json()) as { token?: unknown }
    if (typeof issuedBody.token !== 'string') throw new Error('invalid_host_enrollment_response')
    const exchanged = await this.#request('/host/enrollments', {
      method: 'POST',
      body: JSON.stringify({ token: issuedBody.token }),
      ownerAuthenticated: false,
    })
    const enrolled = (await exchanged.json()) as { hostId?: unknown; credential?: unknown }
    if (typeof enrolled.hostId !== 'string' || typeof enrolled.credential !== 'string') {
      throw new Error('invalid_host_enrollment_response')
    }
    await this.options.credentialStore.save(enrolled.hostId, enrolled.credential)
    await this.options.credentialStored?.()
  }

  async #request(
    path: string,
    input: { method?: string; body?: string; ownerAuthenticated?: boolean } = {}
  ): Promise<Response> {
    const response = await (this.options.fetch ?? fetch)(`${this.options.baseUrl()}${path}`, {
      method: input.method ?? 'GET',
      headers: {
        ...(input.body ? { 'content-type': 'application/json' } : {}),
        ...(input.ownerAuthenticated === false
          ? {}
          : { authorization: `Bearer ${this.options.ownerCredential()}` }),
      },
      ...(input.body ? { body: input.body } : {}),
    })
    if (!response.ok) throw new Error(`host_management_failed_${response.status}`)
    return response
  }
}

function readProjection(value: unknown): HostManagementProjection {
  if (typeof value !== 'object' || value === null)
    throw new Error('invalid_host_management_response')
  const candidate = value as Record<string, unknown>
  if (
    typeof candidate.hostId !== 'string' ||
    !['online', 'offline', 'revoked'].includes(candidate.status as string) ||
    (candidate.lastActivityAt !== null && typeof candidate.lastActivityAt !== 'string')
  ) {
    throw new Error('invalid_host_management_response')
  }
  return {
    hostId: candidate.hostId,
    status: candidate.status as HostManagementProjection['status'],
    lastActivityAt: candidate.lastActivityAt as string | null,
  }
}
