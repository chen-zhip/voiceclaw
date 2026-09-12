import express from 'express'
import type {
  EnrollmentPrincipal,
  RemoteHostEnrollmentService,
} from './desktop-host/host-enrollment.js'
import { HostEnrollmentError } from './desktop-host/host-enrollment.js'
import { HostManagementError, type HostManagementService } from './desktop-host/host-management.js'
import { getTestPageHTML } from './test-page.js'

export interface RelayHttpApplicationOptions {
  enrollment: RemoteHostEnrollmentService
  management?: HostManagementService
  authenticateOwner(credential: string | undefined): Promise<EnrollmentPrincipal | null>
  port?: number
  testPageEnabled?: boolean
}

export function createRelayHttpApplication(options: RelayHttpApplicationOptions) {
  const app = express()
  app.use(express.json())

  app.get('/health', (_request, response) => {
    response.json({ status: 'ok' })
  })

  app.get('/test', (request, response) => {
    if (!options.testPageEnabled) {
      response.status(404).json({ error: 'Test page disabled in production' })
      return
    }
    const host = request.headers.host ?? `localhost:${options.port ?? 8080}`
    response.type('html').send(getTestPageHTML(host))
  })

  app.post('/host/enrollment-tokens', async (request, response) => {
    const principal = await options.authenticateOwner(
      readBearerCredential(request.headers.authorization)
    )
    if (!principal) {
      response.status(401).json({ error: 'owner_authorization_required' })
      return
    }

    try {
      const result = await options.enrollment.issueToken({
        principal,
        installationId: readRequiredString(request.body, 'installationId'),
      })
      response.status(201).json(result)
    } catch (error) {
      sendEnrollmentError(response, error)
    }
  })

  app.post('/host/enrollments', async (request, response) => {
    try {
      const result = await options.enrollment.exchangeToken({
        token: readRequiredString(request.body, 'token'),
      })
      response.status(201).json(result)
    } catch (error) {
      sendEnrollmentError(response, error)
    }
  })

  app.get('/host/registrations', async (request, response) => {
    const principal = await options.authenticateOwner(
      readBearerCredential(request.headers.authorization)
    )
    if (!principal) {
      response.status(401).json({ error: 'owner_authorization_required' })
      return
    }
    if (!options.management) {
      response.status(404).json({ error: 'host_management_unavailable' })
      return
    }
    try {
      response.json(await options.management.inspect(principal))
    } catch (error) {
      sendManagementError(response, error)
    }
  })

  app.post('/host/registrations/:hostId/revoke', async (request, response) => {
    const principal = await options.authenticateOwner(
      readBearerCredential(request.headers.authorization)
    )
    if (!principal) {
      response.status(401).json({ error: 'owner_authorization_required' })
      return
    }
    if (!options.management) {
      response.status(404).json({ error: 'host_management_unavailable' })
      return
    }
    try {
      await options.management.revoke(principal, request.params.hostId)
      response.status(204).end()
    } catch (error) {
      sendManagementError(response, error)
    }
  })

  app.post('/host/reregistration-tokens', async (request, response) => {
    const principal = await options.authenticateOwner(
      readBearerCredential(request.headers.authorization)
    )
    if (!principal) {
      response.status(401).json({ error: 'owner_authorization_required' })
      return
    }
    if (!options.management) {
      response.status(404).json({ error: 'host_management_unavailable' })
      return
    }
    try {
      const result = await options.management.requestReregistration(
        principal,
        readRequiredString(request.body, 'installationId')
      )
      response.status(201).json(result)
    } catch (error) {
      sendManagementError(response, error)
    }
  })

  return app
}

function sendManagementError(response: express.Response, error: unknown): void {
  if (error instanceof HostManagementError) {
    const status = error.code === 'owner_authorization_required' ? 401 : 409
    response.status(status).json({ error: error.code })
    return
  }
  response.status(500).json({ error: 'internal_error' })
}

function readBearerCredential(value: string | undefined): string | undefined {
  const match = /^Bearer ([^\s]+)$/.exec(value ?? '')
  return match?.[1]
}

function readRequiredString(body: unknown, property: string): string {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return ''
  const value = (body as Record<string, unknown>)[property]
  return typeof value === 'string' ? value : ''
}

function sendEnrollmentError(response: express.Response, error: unknown): void {
  if (error instanceof HostEnrollmentError) {
    response.status(error.code === 'host_limit_reached' ? 409 : 401).json({ error: error.code })
    return
  }
  response.status(500).json({ error: 'internal_error' })
}
