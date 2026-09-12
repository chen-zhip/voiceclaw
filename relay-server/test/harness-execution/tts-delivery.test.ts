import type { TTSProvider } from '../../src/tts/interface.js'
import { describe, expect, it, vi } from 'vitest'
import { HarnessStreamRouter } from '../../src/harness-execution/stream-routing.js'

const identity = {
  invocationId: 'invocation-1',
  bindingId: 'binding-1',
  threadId: 'thread-1',
  turnId: 'turn-1',
  attemptId: 'attempt-1',
  generation: 1,
}

describe('Harness TTS delivery', () => {
  it('streams complete bounded sentence batches and preserves emitted audio', async () => {
    const deliveryModule = await import('../../src/harness-execution/tts-delivery.js').catch(
      () => ({})
    )
    const HarnessSpeechDelivery = Reflect.get(deliveryModule, 'HarnessSpeechDelivery')

    expect(HarnessSpeechDelivery).toBeTypeOf('function')

    const batches: string[] = []
    const audio: unknown[] = []
    const delivery = new HarnessSpeechDelivery({
      tts: provider(batches),
      sentenceBatchSize: 2,
      sendToClient: (event: unknown) => audio.push(event),
    })

    await delivery.write('One. Two. trailing')
    expect(batches).toEqual(['One. Two.'])
    await delivery.write(' text')
    await delivery.finish()
    expect(batches).toEqual(['One. Two.', 'trailing text'])
    expect(audio).toEqual([
      { type: 'audio.delta', data: 'audio:One. Two.' },
      { type: 'audio.delta', data: 'audio:trailing text' },
    ])

    const cjkBatches: string[] = []
    const cjk = new HarnessSpeechDelivery({
      tts: provider(cjkBatches),
      sendToClient: () => {},
    })
    await cjk.write('第一句。注意！真的？尾巴')
    await cjk.finish()
    expect(cjkBatches).toEqual(['第一句。', '注意！', '真的？', '尾巴'])

    const cappedBatches: string[] = []
    const capped = new HarnessSpeechDelivery({
      tts: provider(cappedBatches),
      sentenceBatchSize: 99,
      sendToClient: () => {},
    })
    await capped.write('One. Two. Three. Four. Five.')
    expect(cappedBatches).toEqual(['One. Two. Three. Four. Five.'])

    let active = 0
    let maxActive = 0
    let call = 0
    const warnings: string[] = []
    const preservedAudio: unknown[] = []
    const fallible: TTSProvider = {
      async connect() {},
      async *synthesize(text) {
        active += 1
        maxActive = Math.max(maxActive, active)
        call += 1
        try {
          await new Promise((resolve) => setTimeout(resolve, 5))
          if (call === 2) throw new Error('later synthesis failed')
          yield { data: `audio:${text}` }
        } finally {
          active -= 1
        }
      },
      getPlaybackPosition: () => 0,
      async stop() {},
      async disconnect() {},
    }
    const fallibleDelivery = new HarnessSpeechDelivery({
      tts: fallible,
      sendToClient: (event: unknown) => preservedAudio.push(event),
      warn: (message: string) => warnings.push(message),
    })
    await Promise.all([fallibleDelivery.write('First.'), fallibleDelivery.write('Second.')])
    expect(maxActive).toBe(1)
    expect(preservedAudio).toEqual([{ type: 'audio.delta', data: 'audio:First.' }])
    expect(warnings).toEqual([expect.stringContaining('later synthesis failed')])

    const routedBatches: string[] = []
    const routedDelivery = new HarnessSpeechDelivery({
      tts: provider(routedBatches),
      sendToClient: () => {},
    })
    const router = new HarnessStreamRouter({
      activeAttempt: identity,
      speech: routedDelivery,
      sendToClient: vi.fn(),
    })
    await router.route(
      event(1, 'semantic-output', { audience: 'public', channel: 'speech', text: 'Trailing route' })
    )
    await router.route(event(2, 'terminal', { outcome: 'completed' }))
    expect(routedBatches).toEqual(['Trailing route'])
  })
})

function provider(batches: string[]): TTSProvider {
  return {
    async connect() {},
    async *synthesize(text) {
      batches.push(text)
      yield { data: `audio:${text}` }
    },
    getPlaybackPosition: () => 0,
    async stop() {},
    async disconnect() {},
  }
}

function event(
  sequence: number,
  kind: 'semantic-output' | 'terminal',
  payload: Record<string, unknown>
) {
  return { ...identity, sequence, kind, payload }
}
