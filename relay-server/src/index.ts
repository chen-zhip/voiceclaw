import 'dotenv/config'
import { initLangfuse, shutdownLangfuse } from './tracing/langfuse.js'
// initLangfuse must run BEFORE any module that may create OTEL spans on import,
// since the NodeSDK replaces the global TracerProvider.
initLangfuse()

import { mkdir } from 'node:fs/promises'
import { networkInterfaces } from 'node:os'
import { dirname, join } from 'node:path'
import { checkRelayCredential, RelaySession } from './session.js'
import { log, warn, error as logError } from './log.js'
import { gracefulShutdown } from './shutdown.js'
import { createRelayServer } from './server-factory.js'
import { getBridgeConfig, getDiscoveryFilePath } from './device-tokens.js'
import { ControlStateStore } from './plugin-kernel/control-state-store.js'
import { RemoteHostEnrollmentService } from './desktop-host/host-enrollment.js'
import { createRelayHttpApplication } from './relay-http-app.js'
import {
  BundledLocalHostBootstrap,
  DesktopHostConnectionGateway,
} from './desktop-host/host-connection.js'
import { mountRelayWebSocketGateways } from './websocket-gateways.js'
import { HostManagementService } from './desktop-host/host-management.js'
import { ActiveHostAssignmentService } from './desktop-host/active-assignment.js'
import { CapabilityGrantEvaluator } from './plugin-kernel/capability-grants.js'
import { HostContributionRegistry } from './desktop-host/provider-registration.js'
import { bootstrapProductionHostKernel } from './desktop-host/production-kernel.js'

const SHUTDOWN_TIMEOUT_MS = 10_000

const PORT = parseInt(process.env.PORT ?? '8080', 10)
// Default to loopback so a misconfigured relay (no RELAY_API_KEY, no firewall)
// is not reachable from the LAN/tailnet. The desktop sets RELAY_BIND_HOST
// explicitly to 0.0.0.0 when the user opted into mobile pairing.
const HOST = process.env.RELAY_BIND_HOST?.trim() || '127.0.0.1'

const controlStatePath =
  process.env.RELAY_CONTROL_STATE_PATH?.trim() ||
  join(process.cwd(), 'data', 'relay-control-state.json')
await mkdir(dirname(controlStatePath), { recursive: true })
const controlState = await ControlStateStore.open(controlStatePath, {
  requester: { kind: 'relay-authority', id: 'desktop-host-gateway' },
  allowedDirectory: dirname(controlStatePath),
})
const enrollment = new RemoteHostEnrollmentService(controlState, {
  authorizeOwner: (principal) => principal.kind === 'user',
})
const localBootstrap = createLocalBootstrapFromEnvironment()
const hostGateway = new DesktopHostConnectionGateway(controlState, { localBootstrap })
const assignments = new ActiveHostAssignmentService(controlState, hostGateway)
const capabilityGrants = new CapabilityGrantEvaluator(controlState)
const hostContributions = new HostContributionRegistry(hostGateway)
const hostKernel = await bootstrapProductionHostKernel(process.env, controlStatePath, controlState)
const management = new HostManagementService(controlState, hostGateway, enrollment, {
  authorizeOwner: (principal) => principal.kind === 'user',
})
const app = createRelayHttpApplication({
  enrollment,
  management,
  authenticateOwner: async (credential) => {
    if (!credential) return null
    const result = await checkRelayCredential(credential)
    return result.ok ? { kind: 'user', id: 'relay-owner' } : null
  },
  port: PORT,
  testPageEnabled: isTestPageEnabled(),
})

const { server, tls: tlsActive } = createRelayServer(app)

const { clientWebSocketServer: wss, hostWebSocketServer: hostWss } = mountRelayWebSocketGateways(
  server,
  {
    hostGateway,
    assignments,
    contributions: hostContributions,
    kernel: hostKernel,
    authorizeInvocation: ({ hostId, envelope }) =>
      hostGateway.isConnected(hostId) &&
      capabilityGrants.authorize({
        principalId: envelope.principal.id,
        contractId: envelope.contract.id,
        operation: envelope.operation,
        scope: envelope.scope,
        ...(envelope.scope.kind === 'workspace' && envelope.scope.id
          ? { workspaceBindingId: envelope.scope.id }
          : {}),
      }).authorized,
    onClientConnection: (ws) => {
      new RelaySession(ws)
    },
  }
)

// Guards SIGTERM/SIGINT idempotency at the OS-signal layer; the drain-loop
// flag in shutdown.ts guards gracefulShutdown itself.
let shuttingDown = false

async function shutdown() {
  if (shuttingDown) return
  shuttingDown = true
  localBootstrap?.expire()
  log('Shutting down...')

  // If server.close() hangs on a stuck keep-alive socket, the awaits below
  // never complete and gracefulShutdown is never reached. Backstop with a
  // hard-kill timer so the process always exits.
  const hardKill = setTimeout(() => {
    warn('[shutdown] hard-kill timeout reached, forcing exit')
    process.exit(1)
  }, SHUTDOWN_TIMEOUT_MS + 5_000)
  hardKill.unref()

  // Close client sockets first so each RelaySession runs its cleanup()
  // (endSession → adapter disconnect → transcript sync) before we tear
  // down the OTel exporter that ships the final spans.
  wss.clients.forEach((ws) => ws.close())
  hostWss.clients.forEach((ws) => ws.close())
  wss.close()
  hostWss.close()
  await new Promise<void>((resolve) => server.close(() => resolve()))

  // Order: gracefulShutdown drains background tasks (which finish their bg.end()
  // calls) BEFORE shutdownLangfuse flushes the SDK — otherwise span ends race
  // the export pipeline and the last few ops disappear.
  await gracefulShutdown(SHUTDOWN_TIMEOUT_MS)

  // Drain pending spans before exiting — otherwise the last turn of every
  // active session gets dropped on SIGTERM.
  await shutdownLangfuse()
  process.exit(0)
}

function createLocalBootstrapFromEnvironment() {
  const secret = process.env.VOICECLAW_LOCAL_HOST_BOOTSTRAP
  const stackId = process.env.VOICECLAW_LOCAL_HOST_STACK_ID
  const hostId = process.env.VOICECLAW_LOCAL_HOST_ID
  delete process.env.VOICECLAW_LOCAL_HOST_BOOTSTRAP
  delete process.env.VOICECLAW_LOCAL_HOST_STACK_ID
  delete process.env.VOICECLAW_LOCAL_HOST_ID
  if (!secret || !stackId || !hostId) return undefined
  return new BundledLocalHostBootstrap({
    stackId,
    hostId,
    createSecret: () => secret,
  })
}

process.on('SIGTERM', () => {
  void shutdown()
})
process.on('SIGINT', () => {
  void shutdown()
})

if (!process.env.RELAY_API_KEY) {
  // Production must have a relay key or the WS is wide open: any LAN/tailnet
  // peer can run mint_token / tool.exec / session.prep. The dev override is
  // explicit so we never ship "we just forgot to set it".
  if (process.env.NODE_ENV === 'production' && process.env.RELAY_ALLOW_UNAUTHENTICATED !== 'true') {
    logError(
      'RELAY_API_KEY is not set in production — refusing to start (set RELAY_ALLOW_UNAUTHENTICATED=true to bypass for local dev only)'
    )
    process.exit(1)
  }
  warn(
    '⚠️  RELAY_API_KEY is not set — WebSocket connections will not require authentication (dev only)'
  )
}

const httpScheme = tlsActive ? 'https' : 'http'
const wsScheme = tlsActive ? 'wss' : 'ws'
server.listen(PORT, HOST, () => {
  const lanIP = getLanIP()
  log(`Relay server listening on ${httpScheme}://${HOST}:${PORT}`)
  if (isTestPageEnabled()) {
    log(`Test page: ${httpScheme}://localhost:${PORT}/test`)
  }
  if (HOST === '0.0.0.0' && lanIP) {
    log(`Connect from your phone:`)
    log(`  ${wsScheme}://${lanIP}:${PORT}/ws`)
    if (isTestPageEnabled()) {
      log(`  Test page: ${httpScheme}://${lanIP}:${PORT}/test`)
    }
  }
  const bridge = getBridgeConfig()
  if (bridge) {
    log(`Device-token bridge: ${bridge.url} (source=${bridge.source})`)
  } else {
    const discoveryPath = getDiscoveryFilePath()
    warn(
      `Device-token bridge: NOT CONFIGURED — paired mobile clients (vcd_ tokens) will be rejected with 401. ` +
        `Start the desktop app so it writes the discovery file at ${discoveryPath ?? '<unknown>'}, ` +
        `or export VOICECLAW_DEVICE_TOKEN_CHECK_URL + VOICECLAW_DEVICE_TOKEN_CHECK_NONCE before starting the relay.`
    )
  }
})

function isTestPageEnabled(): boolean {
  return process.env.NODE_ENV !== 'production' || process.env.ENABLE_TEST_PAGE === 'true'
}

function getLanIP(): string | null {
  const nets = networkInterfaces()
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] ?? []) {
      if (net.family === 'IPv4' && !net.internal) {
        return net.address
      }
    }
  }
  return null
}
