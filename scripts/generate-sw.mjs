import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const outDir = join(root, 'out')

function walk(dir) {
  const files = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) files.push(...walk(full))
    else files.push(full)
  }
  return files
}

const emitted = walk(outDir)
  .map((file) => `./${relative(outDir, file).split('\\').join('/')}`)
  .filter((file) => file !== './sw.js')
  .sort()
const precache = [...new Set(['./', './index.html', ...emitted])]
const buildHash = createHash('sha256').update(precache.join('\n')).digest('hex').slice(0, 12)
const template = readFileSync(join(root, 'scripts', 'sw.template.js'), 'utf8')
const source = template
  .replace("['__FAIRPOINT_PRECACHE__']", JSON.stringify(precache))
  .replace('__FAIRPOINT_BUILD_HASH__', buildHash)
writeFileSync(join(outDir, 'sw.js'), source)
console.log(`sw.js: ${precache.length} precached files, build ${buildHash}`)
