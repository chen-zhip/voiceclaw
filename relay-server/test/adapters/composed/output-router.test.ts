import { describe, expect, it, vi } from 'vitest'
import { OutputRouter } from '../../../src/adapters/composed/output-router.js'
import type { TTSProvider } from '../../../src/tts/interface.js'
import type { SynthesizeOptions } from '../../../src/tts/interface.js'
import type { RelayEvent } from '../../../src/types.js'
import type { ThinkingContent } from '../../../src/harness-adapter/types.js'
import type { ThinkingEntry } from '../../../src/thinking/storage.js'

describe('OutputRouter', () => {
  it('keeps thinking private', async () => {
    const events: RelayEvent[] = []
    const synthesized: string[] = []
    const stored: ThinkingEntry[] = []
    const traced: ThinkingContent[] = []
    const router = new OutputRouter({
      tts: tts(synthesized),
      sendToClient: (event) => events.push(event),
      saveThinking: async (entry) => {
        stored.push(entry)
        return null
      },
      attachThinkingContent: (content) => {
        traced.push(content)
      },
    })

    const thinking = { steps: ['inspect'], reasoning: 'private chain' }
    const context = { sessionId: 'session-1', turnId: 'turn-1', userQuery: 'inspect' }
    await router.route({ type: 'thinking.delta', content: JSON.stringify(thinking) }, context)
    await router.route({ type: 'speech.delta', content: 'Public answer.' }, context)
    await router.route({ type: 'complete' }, context)

    await vi.waitFor(() => expect(stored).toHaveLength(1))
    expect(stored[0]).toMatchObject({ thinking })
    expect(traced).toEqual([thinking])
    expect(JSON.stringify(events)).not.toContain('private chain')
    expect(synthesized).toEqual(['Public answer.'])
  })

  it.each([
    ['First sentence. trailing', 'First sentence.'],
    ['第一句。后续', '第一句。'],
    ['注意！后续', '注意！'],
    ['真的？后续', '真的？'],
  ])('synthesizes complete sentences', async (delta, expected) => {
    const events: RelayEvent[] = []
    const synthesized: string[] = []
    const router = new OutputRouter({
      tts: tts(synthesized),
      sendToClient: (event) => events.push(event),
    })

    await router.route({ type: 'speech.delta', content: delta })

    expect(synthesized).toEqual([expected])
    expect(events).toContainEqual({ type: 'audio.delta', data: 'YXVkaW8=' })
  })

  it('applies sentence batching', async () => {
    const batches: string[] = []
    const router = new OutputRouter({
      tts: tts(batches),
      sendToClient: () => {},
      sentenceBatchSize: 2,
    })

    await router.route({ type: 'speech.delta', content: 'One. Two. Tail' })
    expect(batches).toEqual(['One. Two.'])
    await router.route({ type: 'complete' })
    expect(batches).toEqual(['One. Two.', 'Tail'])

    const cappedBatches: string[] = []
    const capped = new OutputRouter({
      tts: tts(cappedBatches),
      sendToClient: () => {},
      sentenceBatchSize: 9,
    })
    await capped.route({ type: 'speech.delta', content: 'One. Two. Three. Four.' })
    expect(cappedBatches).toEqual([])
    await capped.route({ type: 'speech.delta', content: 'Five.' })
    expect(cappedBatches).toEqual(['One. Two. Three. Four. Five.'])
  })

  it('bounds TTS concurrency', async () => {
    let active = 0
    let maxActive = 0
    const provider: TTSProvider = {
      async connect() {},
      async *synthesize() {
        active += 1
        maxActive = Math.max(maxActive, active)
        await new Promise((resolve) => setTimeout(resolve, 10))
        yield { data: 'YXVkaW8=' }
        active -= 1
      },
      getPlaybackPosition() {
        return 0
      },
      async stop() {},
      async disconnect() {},
    }
    const router = new OutputRouter({ tts: provider, sendToClient: () => {} })

    await Promise.all([
      router.route({ type: 'speech.delta', content: 'One.' }),
      router.route({ type: 'speech.delta', content: 'Two.' }),
      router.route({ type: 'speech.delta', content: 'Three.' }),
    ])

    expect(maxActive).toBe(1)
  })

  it('routes structured text', async () => {
    const events: RelayEvent[] = []
    const router = new OutputRouter({
      tts: tts([]),
      sendToClient: (event) => events.push(event),
    })

    await router.route({
      type: 'text.delta',
      content: '## Result\nDetails',
      format: 'markdown',
      sections: [{ id: 'result', title: 'Result', content: 'Details' }],
    })

    expect(events).toEqual([
      {
        type: 'transcript.delta',
        text: '## Result\nDetails',
        role: 'assistant',
        source: 'text',
        format: 'markdown',
      },
      {
        type: 'text.section',
        sectionId: 'result',
        title: 'Result',
        content: 'Details',
        format: 'markdown',
      },
    ])
  })

  it('falls back text to speech', async () => {
    const events: RelayEvent[] = []
    const router = new OutputRouter({
      tts: tts([]),
      sendToClient: (event) => events.push(event),
    })

    await router.route({
      type: 'complete',
      output: { speech: { content: 'Concise answer.' } },
    })

    expect(events).toContainEqual({
      type: 'transcript.delta',
      text: 'Concise answer.',
      role: 'assistant',
      source: 'text',
    })
  })

  it('synchronizes screen references', async () => {
    const events: RelayEvent[] = []
    const provider = tts([])
    provider.getPlaybackPosition = () => 9
    const router = new OutputRouter({
      tts: provider,
      sendToClient: (event) => events.push(event),
    })

    await router.route({
      type: 'speech.delta',
      content: 'See this.',
      screenReferences: [{ at: 4, type: 'highlight', target: 'result' }],
    })

    expect(events).toContainEqual({
      type: 'screen.highlight',
      target: 'result',
      mode: 'highlight',
    })
  })

  it('synchronizes completed playback', async () => {
    const events: RelayEvent[] = []
    let playbackPosition = 0
    const provider: TTSProvider = {
      async connect() {},
      async *synthesize(text) {
        yield { data: 'YXVkaW8=' }
        playbackPosition += text.length
      },
      getPlaybackPosition() {
        return playbackPosition
      },
      async stop() {},
      async disconnect() {},
    }
    const router = new OutputRouter({
      tts: provider,
      sendToClient: (event) => events.push(event),
    })

    await router.route({
      type: 'speech.delta',
      content: 'See this.',
      screenReferences: [{ at: 4, type: 'look', target: 'result' }],
    })

    expect(events).toContainEqual({
      type: 'screen.highlight',
      target: 'result',
      mode: 'look',
    })
  })

  it('resets screen-reference positions between turns', async () => {
    const events: RelayEvent[] = []
    let playbackPosition = 0
    const provider: TTSProvider = {
      async connect() {},
      async *synthesize(text) {
        yield { data: 'YXVkaW8=' }
        playbackPosition = text.length
      },
      getPlaybackPosition() {
        return playbackPosition
      },
      async stop() {},
      async disconnect() {},
    }
    const router = new OutputRouter({
      tts: provider,
      sendToClient: (event) => events.push(event),
    })

    await router.route({ type: 'speech.delta', content: 'First turn.' })
    await router.route({ type: 'complete' })
    await router.route({
      type: 'speech.delta',
      content: 'Next.',
      screenReferences: [{ at: 2, type: 'highlight', target: 'next' }],
    })

    expect(events).toContainEqual({
      type: 'screen.highlight',
      target: 'next',
      mode: 'highlight',
    })
  })

  it('completes the turn', async () => {
    const events: RelayEvent[] = []
    const synthesized: string[] = []
    const router = new OutputRouter({
      tts: tts(synthesized),
      sendToClient: (event) => events.push(event),
    })

    await router.route({ type: 'speech.delta', content: 'Trailing speech' })
    await router.route({ type: 'complete' })

    expect(synthesized).toEqual(['Trailing speech'])
    expect(events.at(-1)).toEqual({ type: 'turn.ended' })
  })

  it('forwards prosody hints', async () => {
    const calls: Array<{ text: string; options?: SynthesizeOptions }> = []
    const warnings: string[] = []
    const provider: TTSProvider = {
      async connect() {},
      async *synthesize(text, options) {
        calls.push({ text, ...(options ? { options } : {}) })
        yield { data: 'YXVkaW8=' }
      },
      getPlaybackPosition() {
        return 0
      },
      async stop() {},
      async disconnect() {},
    }
    const router = new OutputRouter({
      tts: provider,
      sendToClient: () => {},
      warn: (message) => warnings.push(message),
    })

    await router.route({
      type: 'speech.delta',
      content: 'Careful.',
      emotion: 'concerned',
      speed: 1.2,
    })

    expect(calls).toEqual([
      {
        text: 'Careful.',
        options: { emotion: 'concerned', speed: 1.2 },
      },
    ])
    expect(warnings).toContainEqual(expect.stringContaining('concerned'))
  })

  it('synthesizes streamed speech immediately with leading metadata', async () => {
    const calls: Array<{ text: string; options?: SynthesizeOptions }> = []
    const provider: TTSProvider = {
      async connect() {},
      async *synthesize(text, options) {
        calls.push({ text, ...(options ? { options } : {}) })
        yield { data: 'YXVkaW8=' }
      },
      getPlaybackPosition() {
        return 0
      },
      async stop() {},
      async disconnect() {},
    }
    const router = new OutputRouter({ tts: provider, sendToClient: () => {} })

    await router.route({
      type: 'speech.delta',
      content: 'Steady.',
      emotion: 'calm',
      speed: 0.9,
    })

    expect(calls).toEqual([{ text: 'Steady.', options: { emotion: 'calm', speed: 0.9 } }])
  })

  it('preserves leading prosody across fragments of one sentence', async () => {
    const calls: Array<{ text: string; options?: SynthesizeOptions }> = []
    const provider: TTSProvider = {
      async connect() {},
      async *synthesize(text, options) {
        calls.push({ text, ...(options ? { options } : {}) })
        yield { data: 'YXVkaW8=' }
      },
      getPlaybackPosition() {
        return 0
      },
      async stop() {},
      async disconnect() {},
    }
    const router = new OutputRouter({ tts: provider, sendToClient: () => {} })

    await router.route({
      type: 'speech.delta',
      content: 'Stay ',
      emotion: 'calm',
      speed: 0.9,
    })
    await router.route({ type: 'speech.delta', content: 'steady.' })

    expect(calls).toEqual([{ text: 'Stay steady.', options: { emotion: 'calm', speed: 0.9 } }])
  })

  it('warns about output separation without suppressing speech', async () => {
    const synthesized: string[] = []
    const warnings: string[] = []
    const router = new OutputRouter({
      tts: tts(synthesized),
      sendToClient: () => {},
      warn: (message) => warnings.push(message),
    })
    const longSpeech = `${'x'.repeat(501)}.`

    await router.route({ type: 'speech.delta', content: longSpeech })
    await router.route({
      type: 'speech.delta',
      content: '```ts\nconst answer = 42\n```.',
    })

    expect(warnings).toContainEqual(expect.stringContaining('500'))
    expect(warnings).toContainEqual(expect.stringContaining('structured'))
    expect(synthesized).toEqual([longSpeech, '```ts', 'const answer = 42', '```.'])
  })

  it('preserves structured speech across chunks', async () => {
    const speech = [
      'Intro. ```ts',
      'const answer = 42;',
      '```',
      '| name | value |',
      '| --- | --- |',
      '| answer | 42 |',
      '- keep this item.',
      'Done.',
    ].join('\n')
    const expected = [
      'Intro.',
      '```ts',
      'const answer = 42;',
      '```',
      '| name | value |',
      '| --- | --- |',
      '| answer | 42 |',
      '- keep this item.',
      'Done.',
    ]

    for (const chunks of [
      [speech],
      [speech.slice(0, 9), speech.slice(9, 37), speech.slice(37, 68), speech.slice(68)],
    ]) {
      const synthesized: string[] = []
      const router = new OutputRouter({ tts: tts(synthesized), sendToClient: () => {} })

      for (const content of chunks) {
        await router.route({ type: 'speech.delta', content })
      }
      await router.route({ type: 'complete' })

      expect(synthesized).toEqual(expected)
    }
  })

  it('warns once for long speech across chunks', async () => {
    const synthesized: string[] = []
    const warnings: string[] = []
    const router = new OutputRouter({
      tts: tts(synthesized),
      sendToClient: () => {},
      warn: (message) => warnings.push(message),
    })
    const first = 'a'.repeat(300)
    const second = `${'b'.repeat(250)}.`

    await router.route({ type: 'speech.delta', content: first })
    await router.route({ type: 'speech.delta', content: second })

    expect(warnings.filter((message) => message.includes('500'))).toHaveLength(1)
    expect(synthesized).toEqual([first + second])
  })

  it('survives TTS failure', async () => {
    const events: RelayEvent[] = []
    const warnings: string[] = []
    const provider: TTSProvider = {
      async connect() {},
      async *synthesize() {
        throw new Error('provider unavailable')
      },
      getPlaybackPosition() {
        return 0
      },
      async stop() {},
      async disconnect() {},
    }
    const router = new OutputRouter({
      tts: provider,
      sendToClient: (event) => events.push(event),
      warn: (message) => warnings.push(message),
    })

    await expect(
      router.route({ type: 'speech.delta', content: 'Spoken.' })
    ).resolves.toBeUndefined()
    await router.route({ type: 'text.delta', content: 'Readable', format: 'plain' })
    await router.route({ type: 'complete' })

    expect(warnings).toContainEqual(expect.stringContaining('provider unavailable'))
    expect(events).toContainEqual({
      type: 'transcript.delta',
      text: 'Readable',
      role: 'assistant',
      source: 'text',
      format: 'plain',
    })
    expect(events.at(-1)).toEqual({ type: 'turn.ended' })
  })
})

function tts(synthesized: string[]): TTSProvider {
  return {
    async connect() {},
    async *synthesize(text) {
      synthesized.push(text)
      yield { data: 'YXVkaW8=' }
    },
    getPlaybackPosition() {
      return 0
    },
    async stop() {},
    async disconnect() {},
  }
}
