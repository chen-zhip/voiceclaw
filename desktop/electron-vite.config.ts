import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    // `@voiceclaw/contracts` is a workspace package whose exports point at
    // TypeScript source, so it must be bundled rather than required at runtime.
    plugins: [externalizeDepsPlugin({ exclude: ['@voiceclaw/contracts'] })],
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: ['@voiceclaw/contracts'] })],
  },
  renderer: {
    plugins: [react()],
  },
})
