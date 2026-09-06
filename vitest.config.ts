import { defineConfig } from 'vitest/config'

// Unit scope: engine and state only. Browser behaviour belongs to the Playwright suite.
export default defineConfig({
  esbuild: { jsx: 'automatic' },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // The agreement battery blocks the event loop for seconds at a time on its
    // 200k-sample MC twins, which starves the forks pool's reporter RPC and
    // trips vitest's onTaskUpdate timeout. Threads keep that channel responsive.
    pool: 'threads',
  },
})
