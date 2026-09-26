export interface GptSovitsBaselineWarning {
  code: 'gpt-sovits-baseline-mismatch'
  boundary: 'synthesis' | 'recognition'
  missing: string[]
  message: string
}

export interface GptSovitsBoundaryReadiness {
  ready: boolean
  warning: GptSovitsBaselineWarning | null
}

export interface GptSovitsBaseline {
  synthesis: {
    method: 'POST'
    endpoint: string
    controlEndpoint: string
    requiredFields: string[]
  }
  recognition: {
    script: string
    arguments: string[]
    requiredAssets: string[]
  }
}

export interface GptSovitsInstallationProbe {
  probeSynthesis(input: {
    endpoint: string
    controlEndpoint: string
    requiredFields: string[]
  }): Promise<{ controlReachable: boolean; supportedFields: string[] }>
  probeRecognition(input: {
    script: string
    arguments: string[]
    requiredAssets: string[]
  }): Promise<{ scriptPresent: boolean; presentArguments: string[]; presentAssets: string[] }>
}

export const GPT_SOVITS_BASELINE: GptSovitsBaseline = {
  synthesis: {
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
  },
  recognition: {
    script: 'tools/asr/funasr_asr.py',
    arguments: ['--input_folder', '--output_folder', '--model_size', '--language'],
    requiredAssets: [
      'tools/asr/models/speech_paraformer-large_asr_nat-zh-cn-16k-common-vocab8404-pytorch',
      'tools/asr/models/speech_fsmn_vad_zh-cn-16k-common-pytorch',
    ],
  },
}

export async function evaluateGptSovitsBaseline(probe: GptSovitsInstallationProbe): Promise<{
  synthesis: GptSovitsBoundaryReadiness
  recognition: GptSovitsBoundaryReadiness
}> {
  const baseline = GPT_SOVITS_BASELINE
  const synthesisProbe = await probe.probeSynthesis({
    endpoint: baseline.synthesis.endpoint,
    controlEndpoint: baseline.synthesis.controlEndpoint,
    requiredFields: baseline.synthesis.requiredFields,
  })
  const recognitionProbe = await probe.probeRecognition({
    script: baseline.recognition.script,
    arguments: baseline.recognition.arguments,
    requiredAssets: baseline.recognition.requiredAssets,
  })

  const missingSynthesis = [
    ...(synthesisProbe.controlReachable ? [] : [`control:${baseline.synthesis.controlEndpoint}`]),
    ...baseline.synthesis.requiredFields.filter(
      (field) => !synthesisProbe.supportedFields.includes(field)
    ),
  ]
  const missingRecognition = [
    ...(recognitionProbe.scriptPresent ? [] : [`script:${baseline.recognition.script}`]),
    ...baseline.recognition.arguments
      .filter((argument) => !recognitionProbe.presentArguments.includes(argument))
      .map((argument) => `argument:${argument}`),
    ...baseline.recognition.requiredAssets
      .filter((asset) => !recognitionProbe.presentAssets.includes(asset))
      .map((asset) => `asset:${asset}`),
  ]

  return {
    synthesis: boundaryReadiness(
      'synthesis',
      missingSynthesis,
      'The configured GPT-SoVITS installation does not match the recorded synthesis capability baseline'
    ),
    recognition: boundaryReadiness(
      'recognition',
      missingRecognition,
      'The configured GPT-SoVITS installation does not match the recorded recognition capability baseline'
    ),
  }
}

function boundaryReadiness(
  boundary: 'synthesis' | 'recognition',
  missing: string[],
  message: string
): GptSovitsBoundaryReadiness {
  return missing.length === 0
    ? { ready: true, warning: null }
    : {
        ready: false,
        warning: { code: 'gpt-sovits-baseline-mismatch', boundary, missing, message },
      }
}
