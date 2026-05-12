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

const emittedFiles = walk(outDir).filter((file) => relative(outDir, file) !== 'sw.js')
const emitted = emittedFiles
  .map((file) => `./${relative(outDir, file).split('\\').join('/')}`)
  .sort()
const precache = [...new Set(['./', './index.html', ...emitted])]
const hash = createHash('sha256')
for (const file of emittedFiles.sort()) {
  const relativePath = `./${relative(outDir, file).split('\\').join('/')}`
  hash.update(relativePath)
  hash.update('\0')
  hash.update(readFileSync(file))
  hash.update('\0')
}
const buildHash = hash.digest('hex').slice(0, 12)
const template = readFileSync(join(root, 'scripts', 'sw.template.js'), 'utf8')
const branding = readFileSync(join(root, 'src', 'app', 'branding.ts'), 'utf8')
const productSlug = branding.match(/export const PRODUCT_SLUG = ['"]([^'"]+)['"]/u)?.[1]
if (productSlug === undefined)
  throw new Error('Could not read PRODUCT_SLUG from src/app/branding.ts')
const source = template
  .replace("['__PRECACHE__']", JSON.stringify(precache))
  .replaceAll('__PRODUCT_SLUG__', productSlug)
  .replace('__BUILD_HASH__', buildHash)
writeFileSync(join(outDir, 'sw.js'), source)
console.log(`sw.js: ${precache.length} precached files, build ${buildHash}`)
