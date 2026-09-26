import { spawn, spawnSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { GPT_SOVITS_BASELINE } from './gpt-sovits-baseline.js'
import type { GptSovitsSynthesisRequest } from '../tts/gpt-sovits.js'
import type { GptSovitsAsrInvocation } from '../stt/gpt-sovits.js'

export interface GptSovitsProcessResult {
  file: string
  code: number
  stdout: string
  stderr: string
}

export interface GptSovitsProcessOptions {
  cwd: string
  env: NodeJS.ProcessEnv
  timeoutMs: number
}

export type GptSovitsRunProcess = (
  file: string,
  args: string[],
  options: GptSovitsProcessOptions
) => Promise<GptSovitsProcessResult>

const DEFAULT_ASR_TIMEOUT_MS = 120_000
const DIAGNOSTIC_LIMIT = 400

// The bundled GPT-SoVITS script calls ModelScope on every invocation, even
// when its local model directories are already complete. Inject this small
// launcher from the project boundary so the vendor script remains untouched:
// local model directories are used offline, while missing models retain the
// upstream download behavior.
const OFFLINE_ASR_BOOTSTRAP = String.raw`
import runpy
import sys
from pathlib import Path
import modelscope

_snapshot_download = modelscope.snapshot_download

def _local_first_snapshot_download(*args, **kwargs):
    local_dir = kwargs.get("local_dir")
    if local_dir:
        path = Path(local_dir)
        if path.is_dir() and any(path.iterdir()):
            return str(path.resolve())
    return _snapshot_download(*args, **kwargs)

modelscope.snapshot_download = _local_first_snapshot_download
script = sys.argv[1]
sys.argv = [script, *sys.argv[2:]]
runpy.run_path(script, run_name="__main__")
`

export function createGptSovitsSynthesisTransport(input: {
  serviceUrl: string
  fetch?: typeof fetch
}): {
  requestSynthesis(request: GptSovitsSynthesisRequest, signal?: AbortSignal): Promise<Uint8Array>
} {
  const doFetch = input.fetch ?? fetch
  const url = new URL(GPT_SOVITS_BASELINE.synthesis.endpoint, input.serviceUrl).toString()
  return {
    async requestSynthesis(
      request: GptSovitsSynthesisRequest,
      signal?: AbortSignal
    ): Promise<Uint8Array> {
      const body = {
        text: request.text,
        text_lang: request.textLang,
        ref_audio_path: request.referenceAudioPath,
        prompt_text: request.promptText,
        prompt_lang: request.promptLang,
        media_type: request.mediaType,
        ...(request.speedFactor === undefined ? {} : { speed_factor: request.speedFactor }),
      }
      let response: Response
      try {
        response = await doFetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
          signal: signal
            ? AbortSignal.any([signal, AbortSignal.timeout(120_000)])
            : AbortSignal.timeout(120_000),
        })
      } catch (error) {
        throw failure(`GPT-SoVITS service is unreachable at ${url}: ${detail(error)}`)
      }
      if (!response.ok) {
        const body = await readText(response)
        throw failure(`GPT-SoVITS service returned ${response.status}${body ? `: ${body}` : ''}`)
      }
      return new Uint8Array(await response.arrayBuffer())
    },
  }
}

export function createGptSovitsAsrRunner(
  options: { runProcess?: GptSovitsRunProcess; timeoutMs?: number } = {}
): { runAsr(invocation: GptSovitsAsrInvocation): Promise<string> } {
  const runProcess = options.runProcess ?? defaultRunProcess
  const timeoutMs = options.timeoutMs ?? DEFAULT_ASR_TIMEOUT_MS
  return {
    async runAsr(invocation: GptSovitsAsrInvocation): Promise<string> {
      const script = join(invocation.gptSovitsRoot, GPT_SOVITS_BASELINE.recognition.script)
      const result = await runWithDeadline(
        runProcess(
          invocation.pythonExecutable,
          [
            '-c',
            OFFLINE_ASR_BOOTSTRAP,
            script,
            '-i',
            invocation.inputDirectory,
            '-o',
            invocation.outputDirectory,
            '-s',
            'large',
            '-l',
            invocation.language,
          ],
          {
            // The bundled script resolves `tools/asr/models/...` relative to the
            // process directory, so it must run from the installation root.
            cwd: invocation.gptSovitsRoot,
            env: asrProcessEnvironment(),
            timeoutMs,
          }
        ),
        timeoutMs
      )
      if (result.code !== 0) {
        throw failure(`GPT-SoVITS offline ASR failed (exit ${result.code})${diagnosticsOf(result)}`)
      }
      const listPath = join(
        invocation.outputDirectory,
        `${basename(invocation.inputDirectory)}.list`
      )
      let contents: string
      try {
        contents = await readFile(listPath, 'utf8')
      } catch {
        throw failure(`GPT-SoVITS offline ASR produced no transcript file${diagnosticsOf(result)}`)
      }
      const transcript = readTranscript(contents)
      if (!transcript.found) {
        const diagnostics = diagnosticsOf(result)
        if (isKnownEmptyFunAsrResult(diagnostics)) return ''
        if (diagnostics) {
          throw failure(
            `GPT-SoVITS offline ASR produced no transcript (it reported no usable result)${diagnostics}`
          )
        }
        return ''
      }
      if (!transcript.text) {
        const diagnostics = diagnosticsOf(result)
        if (isKnownEmptyFunAsrResult(diagnostics)) return ''
        if (diagnostics) {
          throw failure(
            `GPT-SoVITS offline ASR produced no transcript (the recording held no speech it could use)${diagnostics}`
          )
        }
        return ''
      }
      return transcript.text
    },
  }
}

// The bundled script writes one `path|folder|LANG|text` line per input file and
// swallows per-file failures, exiting 0 with an empty file when every file
// failed. Both shapes have to stay distinguishable to the operator.
function readTranscript(contents: string): { found: boolean; text: string } {
  for (const line of contents.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const parts = trimmed.split('|')
    return { found: true, text: parts.slice(3).join('|').trim() }
  }
  return { found: false, text: '' }
}

function isKnownEmptyFunAsrResult(diagnostics: string): boolean {
  // The bundled funasr_asr.py indexes model.generate()[0] directly. FunASR
  // returns [] for silence/noise, so this specific traceback means “no speech
  // recognized”, not a broken model or process.
  return /IndexError:\s*list index out of range/i.test(diagnostics)
}

function defaultRunProcess(
  file: string,
  args: string[],
  options: GptSovitsProcessOptions
): Promise<GptSovitsProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, {
      cwd: options.cwd,
      env: options.env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    let settled = false
    const finish = (result: GptSovitsProcessResult) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(result)
    }
    const timer = setTimeout(() => {
      // A wedged interpreter must not keep the microphone pipeline, the child
      // process, or a modelscope lock alive indefinitely.
      terminateProcessTree(child.pid)
      if (settled) return
      settled = true
      reject(
        failure(
          `GPT-SoVITS offline ASR timed out after ${Math.round(options.timeoutMs / 1000)}s${diagnosticsOf(
            { stdout, stderr }
          )}`
        )
      )
    }, options.timeoutMs)

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout = appendDiagnostic(stdout, chunk.toString())
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr = appendDiagnostic(stderr, chunk.toString())
    })
    child.on('error', (error) => {
      finish({ file, code: 1, stdout, stderr: `${stderr}${error.message}` })
    })
    child.on('close', (code) => {
      finish({ file, code: code ?? 1, stdout, stderr })
    })
  })
}

async function runWithDeadline(
  work: Promise<GptSovitsProcessResult>,
  timeoutMs: number
): Promise<GptSovitsProcessResult> {
  let timer: ReturnType<typeof setTimeout> | undefined
  // The raced work may still settle after the deadline; keep its rejection
  // from surfacing as an unhandled error.
  void work.catch(() => undefined)
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(failure(`GPT-SoVITS offline ASR timed out after ${Math.round(timeoutMs / 1000)}s`))
        }, timeoutMs)
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

// The bundled script calls modelscope's `snapshot_download` on every run, and
// modelscope guards it with a cross-process file lock that a long-lived
// GPT-SoVITS server, or a previous wedged Run, can hold indefinitely. The
// models are already on disk, so contention buys nothing.
function asrProcessEnvironment(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    MODELSCOPE_HUB_FILE_LOCK: 'false',
    // The bundled Python runtime defaults stdout to GBK on Windows, while the
    // Node child-process boundary consumes UTF-8. Keep diagnostic text intact.
    PYTHONIOENCODING: 'utf-8',
  }
}

function appendDiagnostic(current: string, chunk: string): string {
  return `${current}${chunk}`.slice(-DIAGNOSTIC_LIMIT * 2)
}

function diagnosticsOf(result: { stdout: string; stderr: string }): string {
  const lines = `${result.stderr}\n${result.stdout}`
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(-4)
  if (lines.length === 0) return ''
  return `: ${lines.join(' | ').slice(-DIAGNOSTIC_LIMIT)}`
}

function terminateProcessTree(pid: number | undefined): void {
  if (pid === undefined || pid <= 0) return
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' })
    return
  }
  try {
    process.kill(pid)
  } catch {
    // The process already exited.
  }
}

async function readText(response: Response): Promise<string> {
  try {
    const text = await response.text()
    return text.slice(0, 500).replace(/\s+/g, ' ').trim()
  } catch {
    return ''
  }
}

function detail(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function failure(message: string): Error {
  return Object.assign(new Error(message), { userMessage: message })
}
