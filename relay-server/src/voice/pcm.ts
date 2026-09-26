export function resamplePcm16(pcm: Buffer, fromRate: number, toRate: number): Buffer {
  if (fromRate === toRate) return pcm
  const inputSamples = Math.floor(pcm.length / 2)
  if (inputSamples === 0) return Buffer.alloc(0)
  const outputSamples = Math.max(1, Math.round((inputSamples * toRate) / fromRate))
  const output = Buffer.alloc(outputSamples * 2)
  for (let index = 0; index < outputSamples; index += 1) {
    const position = (index * fromRate) / toRate
    const left = Math.min(inputSamples - 1, Math.floor(position))
    const right = Math.min(inputSamples - 1, left + 1)
    const weight = position - left
    const value = pcm.readInt16LE(left * 2) * (1 - weight) + pcm.readInt16LE(right * 2) * weight
    output.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(value))), index * 2)
  }
  return output
}
