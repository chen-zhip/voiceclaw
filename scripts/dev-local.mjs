#!/usr/bin/env node
// One-click local VoiceClaw stack: the Desktop app spawns and owns the bundled
// Relay and the Desktop Host in dev, so this script prepares the environment,
// starts that single command, waits for the Relay to answer, and reports where
// the client and test page are. Ctrl+C stops the whole tree.

import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const relayPort = Number(process.env.VOICECLAW_LOCAL_RELAY_PORT ?? 8080)
const healthTimeoutMs = Number(process.env.VOICECLAW_LOCAL_HEALTH_TIMEOUT_MS ?? 90_000)
const dryRun = process.argv.includes('--dry-run')
const isWindows = process.platform === 'win32'

const steps = []
const warnings = []

function note(message) {
  steps.push(message)
  console.log(`[dev-local] ${message}`)
}

function warn(message) {
  warnings.push(message)
  console.warn(`[dev-local] ${message}`)
}

function checkNode() {
  const major = Number(process.versions.node.split('.')[0])
  if (major < 20) {
    throw new Error(`Node 20+ is required; found ${process.versions.node}`)
  }
  note(`Node ${process.versions.node}`)
}

function checkYarn() {
  // `yarn` on Windows is a .cmd shim, which Node cannot spawn without a shell.
  const result = isWindows
    ? spawnSync('yarn --version', { cwd: repoRoot, stdio: 'pipe', shell: true })
    : spawnSync('yarn', ['--version'], { cwd: repoRoot, stdio: 'pipe' })
  if (result.error || result.status !== 0) {
    throw new Error('yarn is not available on PATH (enable it with `corepack enable`)')
  }
  note(`Yarn ${String(result.stdout).trim()}`)
}

function checkInstall() {
  for (const directory of ['node_modules', join('desktop', 'node_modules')]) {
    if (!existsSync(join(repoRoot, directory))) {
      throw new Error(`${directory} is missing; run \`yarn install\` first`)
    }
  }
  note('workspace dependencies present')
}

function reportEnvironment() {
  const envPath = join(repoRoot, 'relay-server', '.env')
  if (existsSync(envPath)) {
    note('relay-server/.env found (used by `yarn dev:server`, not by the bundled Relay)')
  } else {
    warn('relay-server/.env is missing; only needed for the standalone Relay (`yarn dev:server`)')
  }

  // The bundled Relay receives a fixed allow-list of environment variables
  // (see buildRelayEnv in desktop/src/main/services/relay-server.ts) and reads
  // model provider keys from the Desktop app's stored settings, not from this
  // shell. Say so instead of pretending these are picked up.
  warn(
    'model provider keys (Gemini / OpenAI / xAI) are read from the Desktop app settings, so enter them once in the app UI'
  )
  note(
    'local voice settings (GPT_SOVITS_*) and the Harness plugin selection are forwarded to the bundled Relay'
  )
}

async function waitForHealth(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url)
      if (response.ok) return true
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  return false
}

function startStack() {
  return isWindows
    ? spawn('yarn dev:desktop', {
        cwd: repoRoot,
        env: process.env,
        stdio: 'inherit',
        shell: true,
      })
    : spawn('yarn', ['dev:desktop'], {
        cwd: repoRoot,
        env: process.env,
        stdio: 'inherit',
        detached: true,
      })
}

function stopStack(child) {
  if (!child || child.exitCode !== null) return
  if (isWindows) {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
    return
  }
  try {
    process.kill(-child.pid, 'SIGTERM')
  } catch {
    child.kill('SIGTERM')
  }
}

async function main() {
  console.log(`[dev-local] repository ${repoRoot}`)
  checkNode()
  checkYarn()
  checkInstall()
  reportEnvironment()

  if (dryRun) {
    note('dry run: environment checks passed; not starting the Desktop app')
    return
  }

  note('starting `yarn dev:desktop` (bundled Relay + Desktop Host + Desktop client)')
  const child = startStack()

  let stopping = false
  const shutdown = () => {
    if (stopping) return
    stopping = true
    note('stopping the local stack')
    stopStack(child)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
  child.on('exit', (code) => {
    if (!stopping) {
      note(`Desktop app exited with code ${code ?? 0}`)
      process.exit(code ?? 0)
    }
  })

  const healthUrl = `http://127.0.0.1:${relayPort}/health`
  const healthy = await waitForHealth(healthUrl, healthTimeoutMs)
  if (healthy) {
    note(`Relay is healthy at ${healthUrl}`)
    note(`Relay WebSocket: ws://127.0.0.1:${relayPort}/ws`)
    note(`Browser test page: http://127.0.0.1:${relayPort}/test`)
    note('The Desktop client window is the VoiceClaw app that just opened')
  } else {
    warn(
      `Relay did not answer ${healthUrl} within ${Math.round(healthTimeoutMs / 1000)}s; check the Desktop app logs`
    )
  }
  note('Press Ctrl+C to stop the Relay, the Desktop Host, and the Desktop client')
}

main().catch((error) => {
  console.error(`[dev-local] ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
