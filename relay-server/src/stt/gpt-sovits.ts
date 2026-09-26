import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { STTConfig, STTProvider, TranscriptCallback } from './interface.js'
import {
  evaluateGptSovitsBaseline,
  type GptSovitsInstallationProbe,
} from '../voice/gpt-sovits-baseline.js'
import { createGptSovitsAsrRunner } from '../voice/gpt-sovits-transports.js'
import { resamplePcm16 } from '../voice/pcm.js'
import { checkGptSovitsRecognition } from '../voice/gpt-sovits-readiness.js'

export interface GptSovitsAsrInvocation {
  gptSovitsRoot: string
  pythonExecutable: string
  language: string
  inputDirectory: string
  outputDirectory: string
}

export interface GptSovitsSttDependencies {
  runAsr(invocation: GptSovitsAsrInvocation): Promise<string>
  probeInstallation?: GptSovitsInstallationProbe
}

export interface GptSovitsSttSettings {
  gptSovitsRoot: string
  pythonExecutable: string
  language: string
  endpointingMs: number
  sampleRate: number
  silenceThreshold: number
}

const FRAME_SAMPLES = 160
const ASR_SAMPLE_RATE = 16000
const DEFAULT_ENDPOINTING_MS = 800
const DEFAULT_SAMPLE_RATE = 16000
const DEFAULT_SILENCE_THRESHOLD = 200
const MAX_NOISE_CALIBRATION_MS = 500
const MAX_UNCLASSIFIED_ONSET_MS = 2000
const PRE_ROLL_MS = 300
const SPEECH_TO_NOISE_RATIO = 1.35

export class GptSovitsSTTProvider implements STTProvider {
  readonly id = 'gpt-sovits-stt'
  // Each utterance starts the bundled FunASR CLI, which loads its models from
  // disk (and lets modelscope revalidate them) before it transcribes anything.
  readonly finalTranscriptDeadlineMs = 60_000
  #settings: GptSovitsSttSettings | null = null
  #runAsr: GptSovitsSttDependencies['runAsr'] | null = null
  #pcm: Buffer = Buffer.alloc(0)
  #silenceBytes = 0
  #tail: Buffer = Buffer.alloc(0)
  #noiseFloorRms: number | null = null
  #calibrationBytes = 0
  #calibrationMinRms = Number.POSITIVE_INFINITY
  #peakRms = 0
  #speechObserved = false
  #noiseOnlyConfirmed = false
  #finalCallbacks: TranscriptCallback[] = []
  #partialCallbacks: TranscriptCallback[] = []
  #errorCallbacks: Array<(message: string) => void> = []
  #pending: Promise<void> = Promise.resolve()
  #generation = 0

  constructor(private readonly dependencies: Partial<GptSovitsSttDependencies> = {}) {}

  async connect(config: STTConfig): Promise<void> {
    const settings = readGptSovitsSttSettings(config)
    this.#generation += 1
    this.#settings = null
    this.#reset()
    const probe = this.dependencies.probeInstallation
    if (!probe && !this.dependencies.runAsr) {
      await checkGptSovitsRecognition(settings.gptSovitsRoot, settings.pythonExecutable)
    }
    if (probe) {
      const baseline = await evaluateGptSovitsBaseline(probe)
      if (!baseline.recognition.ready) {
        throw failure(
          baseline.recognition.warning?.message ?? 'GPT-SoVITS recognition baseline mismatch'
        )
      }
    }
    this.#settings = settings
    this.#runAsr = this.dependencies.runAsr ?? createGptSovitsAsrRunner().runAsr
  }

  processAudio(pcmData: string): void {
    const settings = this.#settings
    if (!settings) return
    this.#tail = Buffer.concat([this.#tail, Buffer.from(pcmData, 'base64')])
    const frameBytes = FRAME_SAMPLES * 2
    while (this.#tail.length >= frameBytes) {
      const frame = this.#tail.subarray(0, frameBytes)
      this.#tail = this.#tail.subarray(frameBytes)
      this.#pcm = Buffer.concat([this.#pcm, frame])
      this.#observeFrame(frameRms(frame), frameBytes, settings)
      const thresholdBytes = Math.round((settings.endpointingMs / 1000) * settings.sampleRate * 2)
      if (this.#speechObserved && thresholdBytes > 0 && this.#silenceBytes >= thresholdBytes) {
        const utterance = this.#pcm.subarray(0, this.#pcm.length - this.#silenceBytes)
        this.#resetUtterance()
        this.#recognize(utterance)
      }
    }
  }

  commit(): void {
    if (!this.#settings) return
    const complete = Buffer.concat([this.#pcm, this.#tail])
    const utterance = complete.subarray(0, complete.length - this.#silenceBytes)
    this.#resetUtterance()
    this.#recognize(utterance)
  }

  onPartialTranscript(callback: TranscriptCallback): void {
    this.#partialCallbacks.push(callback)
  }

  onFinalTranscript(callback: TranscriptCallback): void {
    this.#finalCallbacks.push(callback)
  }

  onError(callback: (message: string) => void): void {
    this.#errorCallbacks.push(callback)
  }

  async disconnect(): Promise<void> {
    this.#generation += 1
    this.#reset()
    this.#settings = null
    await this.#pending
  }

  #reset(): void {
    this.#noiseFloorRms = null
    this.#calibrationBytes = 0
    this.#calibrationMinRms = Number.POSITIVE_INFINITY
    this.#resetUtterance()
  }

  #resetUtterance(): void {
    this.#pcm = Buffer.alloc(0)
    this.#tail = Buffer.alloc(0)
    this.#silenceBytes = 0
    this.#peakRms = this.#noiseFloorRms ?? 0
    this.#speechObserved = false
    this.#noiseOnlyConfirmed = this.#noiseFloorRms !== null
  }

  #observeFrame(rms: number, frameBytes: number, settings: GptSovitsSttSettings): void {
    this.#peakRms = Math.max(this.#peakRms, rms)
    if (this.#noiseFloorRms === null) {
      this.#calibrationBytes += frameBytes
      this.#calibrationMinRms = Math.min(this.#calibrationMinRms, rms)
      const calibrationMs = Math.min(MAX_NOISE_CALIBRATION_MS, settings.endpointingMs)
      const calibrationTargetBytes = Math.max(
        frameBytes,
        Math.round((calibrationMs / 1000) * settings.sampleRate * 2)
      )
      if (this.#calibrationBytes < calibrationTargetBytes) return

      this.#noiseFloorRms = this.#calibrationMinRms
      const threshold = adaptiveSpeechThreshold(this.#noiseFloorRms, settings.silenceThreshold)
      const quiet = rms <= threshold
      this.#speechObserved = this.#peakRms > threshold
      this.#silenceBytes = this.#speechObserved && quiet ? frameBytes : 0
      if (!this.#speechObserved) this.#trimToPreRoll(settings)
      return
    }

    const threshold = adaptiveSpeechThreshold(this.#noiseFloorRms, settings.silenceThreshold)
    if (rms > threshold) {
      this.#speechObserved = true
      this.#silenceBytes = 0
      return
    }

    // Capture can begin while the user is already speaking. If calibration
    // initially treats that stable high level as noise, the following clear
    // energy drop proves the buffered region was speech.
    if (
      !this.#speechObserved &&
      this.#peakRms > Math.max(settings.silenceThreshold, rms * SPEECH_TO_NOISE_RATIO)
    ) {
      this.#speechObserved = true
    }
    this.#silenceBytes = this.#speechObserved ? this.#silenceBytes + frameBytes : 0
    this.#updateNoiseFloor(rms)
    if (!this.#speechObserved) this.#trimToPreRoll(settings)
  }

  #updateNoiseFloor(rms: number): void {
    if (this.#noiseFloorRms === null) return
    const weight = rms < this.#noiseFloorRms ? 0.2 : 0.02
    this.#noiseFloorRms += (rms - this.#noiseFloorRms) * weight
  }

  #trimToPreRoll(settings: GptSovitsSttSettings): void {
    if (!this.#noiseOnlyConfirmed) {
      const unclassifiedBytes = Math.round(
        (MAX_UNCLASSIFIED_ONSET_MS / 1000) * settings.sampleRate * 2
      )
      if (this.#pcm.length <= unclassifiedBytes) return
      this.#noiseOnlyConfirmed = true
    }
    const preRollBytes = Math.round((PRE_ROLL_MS / 1000) * settings.sampleRate * 2)
    if (this.#pcm.length > preRollBytes) this.#pcm = this.#pcm.subarray(-preRollBytes)
  }

  #recognize(utterance: Buffer): void {
    const settings = this.#settings
    if (!settings || utterance.length < 2) return
    const generation = this.#generation
    const recording = Buffer.from(utterance)
    // Creating the Promise starts #run immediately. Defer that call until the
    // previous invocation settles so separate FunASR processes never load and
    // use the same local models concurrently.
    this.#pending = this.#pending.then(async () => {
      if (generation !== this.#generation) return
      await this.#run(settings, recording, generation)
    })
  }

  async #run(settings: GptSovitsSttSettings, utterance: Buffer, generation: number): Promise<void> {
    const runAsr = this.#runAsr
    if (!runAsr) {
      this.#reportError('GPT-SoVITS recognition runtime is not configured')
      return
    }
    const directory = await mkdtemp(join(tmpdir(), 'voiceclaw-gpt-sovits-asr-'))
    const inputDirectory = join(directory, 'in')
    const outputDirectory = join(directory, 'out')
    try {
      await mkdir(inputDirectory, { recursive: true })
      await mkdir(outputDirectory, { recursive: true })
      await writeFile(
        join(inputDirectory, 'utterance.wav'),
        wav(
          settings.sampleRate === ASR_SAMPLE_RATE
            ? utterance
            : resamplePcm16(utterance, settings.sampleRate, ASR_SAMPLE_RATE),
          ASR_SAMPLE_RATE
        )
      )
      const text = await runAsr({
        gptSovitsRoot: settings.gptSovitsRoot,
        pythonExecutable: settings.pythonExecutable,
        language: settings.language,
        inputDirectory,
        outputDirectory,
      })
      if (generation !== this.#generation) return
      const trimmed = text.trim()
      // VAD can legitimately produce an utterance that FunASR cannot turn
      // into text (silence, room noise, or a clipped onset). That is not a
      // provider failure and must not surface as a user-visible STT error.
      if (!trimmed) return
      for (const callback of this.#finalCallbacks) callback(trimmed)
    } catch (error) {
      if (generation !== this.#generation) return
      this.#reportError(
        `GPT-SoVITS recognition failed: ${error instanceof Error ? error.message : String(error)}`
      )
    } finally {
      await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    }
  }

  #reportError(message: string): void {
    for (const callback of this.#errorCallbacks) callback(message)
  }
}

export function readGptSovitsSttSettings(config: STTConfig): GptSovitsSttSettings {
  const extended = config as STTConfig & Partial<GptSovitsSttSettings>
  const gptSovitsRoot = extended.gptSovitsRoot ?? process.env.GPT_SOVITS_ROOT
  if (!gptSovitsRoot) {
    throw failure('GPT-SoVITS recognition needs the local installation path')
  }
  return {
    gptSovitsRoot,
    pythonExecutable: extended.pythonExecutable ?? process.env.GPT_SOVITS_PYTHON ?? 'python',
    language: extended.language ?? process.env.GPT_SOVITS_ASR_LANGUAGE ?? 'zh',
    endpointingMs: extended.endpointingMs ?? DEFAULT_ENDPOINTING_MS,
    sampleRate: extended.sampleRate ?? DEFAULT_SAMPLE_RATE,
    silenceThreshold: extended.silenceThreshold ?? DEFAULT_SILENCE_THRESHOLD,
  }
}

function frameRms(frame: Buffer): number {
  let sumOfSquares = 0
  let samples = 0
  for (let offset = 0; offset < frame.length; offset += 2) {
    const sample = frame.readInt16LE(offset)
    sumOfSquares += sample * sample
    samples += 1
  }
  return samples === 0 ? 0 : Math.sqrt(sumOfSquares / samples)
}

function adaptiveSpeechThreshold(noiseFloorRms: number, minimumThreshold: number): number {
  return Math.max(minimumThreshold, noiseFloorRms * SPEECH_TO_NOISE_RATIO)
}

function wav(pcm: Buffer, sampleRate: number): Buffer {
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + pcm.length, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(sampleRate * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(pcm.length, 40)
  return Buffer.concat([header, pcm])
}

function failure(message: string): Error {
  return Object.assign(new Error(message), { userMessage: message })
}
