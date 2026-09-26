import type { HarnessExecutionEvent } from '@voiceclaw/contracts'
import { describe, expect, it, vi } from 'vitest'
import { createAdapter } from '../../../src/adapters/index.js'
import type { HarnessAdapter } from '../../../src/harness-adapter/interface.js'
import type {
  AcceptedHarnessAttempt,
  HarnessRoutingPort,
} from '../../../src/harness-execution/dispatch.js'
import type { STTProvider } from '../../../src/stt/interface.js'
import type { TTSProvider } from '../../../src/tts/interface.js'
import type { RelayEvent, SessionConfigEvent } from '../../../src/types.js'

describe('STT/TTS typed input', () => {
  it('dispatches text input through the Harness path without using STT', async () => {
    const events: RelayEvent[] = []
    const acceptTranscript = vi.fn(async () => ({
      status: 'dispatched' as const,
      accepted: attempt([
        harnessEvent(1, 'semantic-output', {
          audience: 'public',
          channel: 'screen',
          text: 'Simulated Codex output.',
        }),
        harnessEvent(2, 'terminal', { outcome: 'completed' }),
      ]),
    }))
    const adapter = createAdapter(sessionConfig(), {
      createSTTProvider: () => sttThatMustNotBeUsed(),
      createHarnessAdapter: () => harnessThatMustNotReceiveText(),
      createTTSProvider: () => fakeTts(),
      harnessRouting: routing(acceptTranscript),
      sendToClient: (event) => events.push(event),
    })

    await adapter.connect(sessionConfig(), (event) => events.push(event))
    adapter.injectContext('typed Codex request')

    await vi.waitFor(() => expect(acceptTranscript).toHaveBeenCalled())
    expect(acceptTranscript).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'conversation-text',
        text: 'typed Codex request',
        final: true,
      })
    )
    expect(events).toContainEqual({
      type: 'transcript.done',
      text: 'typed Codex request',
      role: 'user',
    })
    expect(events).toContainEqual({
      type: 'harness.semantic-output',
      classification: 'public-screen',
      text: 'Simulated Codex output.',
    })
    await vi.waitFor(() =>
      expect(events.some((event) => event.type === 'harness.terminal')).toBe(true)
    )
    expect(events.some((event) => event.type === 'harness.terminal')).toBe(true)
  })
})

function sessionConfig(): SessionConfigEvent {
  return {
    type: 'session.config',
    provider: 'openai',
    voice: 'test',
    brainAgent: 'none',
    apiKey: 'test',
    mode: 'stt-tts',
    inputMode: 'text',
    sttProvider: 'deepgram',
    harness: 'claude-code',
    ttsProvider: 'elevenlabs',
    sessionKey: 'conversation-text',
    harnessBinding: {
      bindingId: 'binding-1',
      providerId: 'codex',
      workspaceBindingId: 'workspace-1',
      generation: 1,
    },
  }
}

function routing(acceptTranscript: HarnessRoutingPort['acceptTranscript']): HarnessRoutingPort {
  return {
    acceptTranscript,
    completeAttempt: async () => undefined,
    cancelController: () =>
      ({
        cancel: async () => ({ accepted: false as const, code: 'not-active' }),
      }) as never,
  }
}

function attempt(events: HarnessExecutionEvent[]): AcceptedHarnessAttempt {
  return {
    conversationId: 'conversation-text',
    turnId: 'turn-1',
    attemptId: 'attempt-1',
    identity: {
      invocationId: 'invocation-1',
      bindingId: 'binding-1',
      threadId: 'thread-1',
      turnId: 'turn-1',
      attemptId: 'attempt-1',
      generation: 1,
    },
    binding: {
      bindingId: 'binding-1',
      providerId: 'codex',
      workspaceBindingId: 'workspace-1',
      generation: 1,
    },
    events,
  }
}

function harnessEvent(
  sequence: number,
  kind: HarnessExecutionEvent['kind'],
  payload: Record<string, unknown>
): HarnessExecutionEvent {
  return {
    invocationId: 'invocation-1',
    bindingId: 'binding-1',
    threadId: 'thread-1',
    turnId: 'turn-1',
    attemptId: 'attempt-1',
    generation: 1,
    sequence,
    kind,
    payload,
  } as HarnessExecutionEvent
}

function sttThatMustNotBeUsed(): STTProvider {
  return {
    async connect() {
      throw new Error('STT must not connect for typed input')
    },
    processAudio() {
      throw new Error('STT must not receive typed input')
    },
    commit() {
      throw new Error('STT must not commit typed input')
    },
    onPartialTranscript() {},
    onFinalTranscript() {},
    onError() {},
    async disconnect() {},
  }
}

function harnessThatMustNotReceiveText(): HarnessAdapter {
  return {
    id: 'claude-code',
    capabilities: { structuredOutput: true, interruption: false, overlay: false, streaming: true },
    async connect() {},
    async sendMessage() {
      throw new Error('local Harness must not receive typed input')
    },
    async disconnect() {},
  }
}

function fakeTts(): TTSProvider {
  return {
    async connect() {},
    async *synthesize() {
      yield { data: 'YXVkaW8=' }
    },
    getPlaybackPosition: () => 0,
    async stop() {},
    async disconnect() {},
  }
}
