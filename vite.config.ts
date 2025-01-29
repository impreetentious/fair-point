import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

function offlineWorker(): Plugin {
  return {
    name: 'fairpoint-offline-worker',
    apply: 'build',
    generateBundle(_options, bundle) {
      const emittedFiles = Object.values(bundle)
        .filter((entry) => entry.fileName !== 'sw.js')
        .map((entry) => `./${entry.fileName}`)
        .sort()
      const precache = [...new Set(['./', './index.html', ...emittedFiles])]
      const buildHash = createHash('sha256').update(precache.join('\n')).digest('hex').slice(0, 12)
      const source = readFileSync(new URL('./src/app/sw.ts', import.meta.url), 'utf8')
        .replace("['__FAIRPOINT_PRECACHE__']", JSON.stringify(precache))
        .replace('__FAIRPOINT_BUILD_HASH__', buildHash)
      this.emitFile({ type: 'asset', fileName: 'sw.js', source })
    },
  }
}

export default defineConfig({
  base: './',
  plugins: [react(), offlineWorker()],
})
