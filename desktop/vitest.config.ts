import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.test.{ts,tsx}', 'test/**/*.test.{ts,tsx}'],
    testTimeout: 10_000,
  },
})
