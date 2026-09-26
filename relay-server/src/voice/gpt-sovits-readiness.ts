import { access, readFile, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { GPT_SOVITS_BASELINE } from './gpt-sovits-baseline.js'

export async function checkGptSovitsSynthesis(serviceUrl: string): Promise<void> {
  try {
    const response = await fetch(new URL('/openapi.json', serviceUrl), {
      signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const api = (await response.json()) as {
      paths?: Record<string, { post?: unknown; get?: unknown }>
      components?: { schemas?: { TTS_Request?: { properties?: Record<string, unknown> } } }
    }
    const baseline = GPT_SOVITS_BASELINE.synthesis
    if (
      !api.paths?.[baseline.endpoint]?.post ||
      !api.paths?.[baseline.controlEndpoint] ||
      baseline.requiredFields.some(
        (field) => !(field in (api.components?.schemas?.TTS_Request?.properties ?? {}))
      )
    ) {
      throw new Error('synthesis capability baseline mismatch')
    }
  } catch (error) {
    throw failure(
      `GPT-SoVITS service readiness failed: ${error instanceof Error ? error.message : String(error)}`
    )
  }
}

export async function checkGptSovitsRecognition(
  root: string,
  pythonExecutable: string
): Promise<void> {
  try {
    const baseline = GPT_SOVITS_BASELINE.recognition
    const script = await readFile(join(root, baseline.script), 'utf8')
    if (baseline.arguments.some((argument) => !script.includes(argument)))
      throw new Error('ASR argument baseline mismatch')
    for (const asset of baseline.requiredAssets) {
      const path = join(root, asset)
      if (!(await stat(path)).isDirectory() || (await readdir(path)).length === 0)
        throw new Error('ASR model asset missing')
    }
    await access(join(root, baseline.script))
    await promisify(execFile)(pythonExecutable, ['-c', 'import funasr, modelscope'], {
      cwd: root,
      timeout: 20_000,
      windowsHide: true,
      maxBuffer: 64 * 1024,
    })
  } catch {
    throw failure(
      'GPT-SoVITS recognition readiness failed. Check the ASR runtime, script, and model assets.'
    )
  }
}

function failure(message: string): Error {
  return Object.assign(new Error(message), { userMessage: message })
}
