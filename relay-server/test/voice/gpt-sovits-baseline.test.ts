import { describe, expect, it } from 'vitest'

async function loadBaseline() {
  return import('../../src/voice/gpt-sovits-baseline.js')
}

const completeProbe = {
  probeSynthesis: async () => ({
    controlReachable: true,
    supportedFields: [
      'text',
      'text_lang',
      'ref_audio_path',
      'prompt_text',
      'prompt_lang',
      'media_type',
      'speed_factor',
    ],
  }),
  probeRecognition: async () => ({
    scriptPresent: true,
    presentArguments: ['--input_folder', '--output_folder', '--model_size', '--language'],
    presentAssets: [
      'tools/asr/models/speech_paraformer-large_asr_nat-zh-cn-16k-common-vocab8404-pytorch',
      'tools/asr/models/speech_fsmn_vad_zh-cn-16k-common-pytorch',
    ],
  }),
}

describe('GPT-SoVITS capability baseline', () => {
  it('records the synthesis fields, ASR arguments, and required local assets', async () => {
    const { GPT_SOVITS_BASELINE } = await loadBaseline()

    expect(GPT_SOVITS_BASELINE.synthesis).toEqual({
      method: 'POST',
      endpoint: '/tts',
      controlEndpoint: '/control',
      requiredFields: [
        'text',
        'text_lang',
        'ref_audio_path',
        'prompt_text',
        'prompt_lang',
        'media_type',
        'speed_factor',
      ],
    })
    expect(GPT_SOVITS_BASELINE.recognition).toEqual({
      script: 'tools/asr/funasr_asr.py',
      arguments: ['--input_folder', '--output_folder', '--model_size', '--language'],
      requiredAssets: [
        'tools/asr/models/speech_paraformer-large_asr_nat-zh-cn-16k-common-vocab8404-pytorch',
        'tools/asr/models/speech_fsmn_vad_zh-cn-16k-common-pytorch',
      ],
    })
  })

  it('reports each boundary ready against a matching installation', async () => {
    const { evaluateGptSovitsBaseline } = await loadBaseline()

    const result = await evaluateGptSovitsBaseline(completeProbe)

    expect(result.synthesis).toEqual({ ready: true, warning: null })
    expect(result.recognition).toEqual({ ready: true, warning: null })
  })

  it('fails only the mismatching boundary closed with a persistent warning', async () => {
    const { evaluateGptSovitsBaseline } = await loadBaseline()

    const result = await evaluateGptSovitsBaseline({
      ...completeProbe,
      probeSynthesis: async () => ({
        controlReachable: true,
        supportedFields: ['text', 'text_lang', 'ref_audio_path', 'media_type'],
      }),
    })

    expect(result.synthesis).toEqual({
      ready: false,
      warning: {
        code: 'gpt-sovits-baseline-mismatch',
        boundary: 'synthesis',
        missing: ['prompt_text', 'prompt_lang', 'speed_factor'],
        message:
          'The configured GPT-SoVITS installation does not match the recorded synthesis capability baseline',
      },
    })
    expect(result.recognition).toEqual({ ready: true, warning: null })
  })

  it('fails recognition closed when a recorded asset or argument is absent', async () => {
    const { evaluateGptSovitsBaseline } = await loadBaseline()

    const result = await evaluateGptSovitsBaseline({
      ...completeProbe,
      probeRecognition: async () => ({
        scriptPresent: true,
        presentArguments: ['--input_folder', '--output_folder'],
        presentAssets: [
          'tools/asr/models/speech_paraformer-large_asr_nat-zh-cn-16k-common-vocab8404-pytorch',
        ],
      }),
    })

    expect(result.recognition.ready).toBe(false)
    expect(result.recognition.warning).toMatchObject({
      code: 'gpt-sovits-baseline-mismatch',
      boundary: 'recognition',
      missing: [
        'argument:--model_size',
        'argument:--language',
        'asset:tools/asr/models/speech_fsmn_vad_zh-cn-16k-common-pytorch',
      ],
    })
    expect(result.synthesis).toEqual({ ready: true, warning: null })
  })
})
