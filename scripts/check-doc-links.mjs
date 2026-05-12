import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

async function markdownFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(
    entries.map((entry) => {
      const filePath = path.join(directory, entry.name)
      return entry.isDirectory() ? markdownFiles(filePath) : Promise.resolve([filePath])
    }),
  )
  return nested.flat().filter((file) => file.endsWith('.md'))
}

function headingSlugs(source) {
  const counts = new Map()
  const slugs = new Set()
  let fence = null
  for (const line of source.split('\n')) {
    const marker = /^\s*(`{3,}|~{3,})/u.exec(line)?.[1]
    if (marker !== undefined) {
      if (fence === null) fence = marker[0]
      else if (marker[0] === fence) fence = null
      continue
    }
    if (fence !== null) continue
    const heading = /^#{1,6}\s+(.+?)\s*#*$/u.exec(line)?.[1]
    if (heading === undefined) continue
    const base = heading
      .toLowerCase()
      .replace(/<[^>]+>/gu, '')
      .replace(/[^\p{L}\p{N}\s-]/gu, '')
      .trim()
      .replace(/\s+/gu, '-')
    const count = counts.get(base) ?? 0
    counts.set(base, count + 1)
    slugs.add(count === 0 ? base : `${base}-${count}`)
  }
  return slugs
}

const files = ['README.md', 'BENCHMARKS.md', ...(await markdownFiles('docs'))]
const failures = []

for (const file of files) {
  const source = await readFile(file, 'utf8')
  let fence = null
  for (const [index, line] of source.split('\n').entries()) {
    const marker = /^\s*(`{3,}|~{3,})/u.exec(line)?.[1]
    if (marker !== undefined) {
      if (fence === null) fence = marker[0]
      else if (marker[0] === fence) fence = null
      continue
    }
    if (fence !== null) continue
    for (const match of line.matchAll(/\[[^\]]*\]\(([^)\s]+)(?:\s+[^)]*)?\)/gu)) {
      const reference = match[1].replace(/^<|>$/gu, '')
      if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/iu.test(reference)) continue
      const [rawTarget, rawFragment] = reference.split('#', 2)
      const target = path.normalize(
        rawTarget === '' ? file : path.resolve(path.dirname(file), decodeURIComponent(rawTarget)),
      )
      if (!existsSync(target)) {
        failures.push(`${file}:${index + 1}: missing target ${reference}`)
        continue
      }
      if (rawFragment === undefined || rawFragment === '' || !target.endsWith('.md')) continue
      const slugs = headingSlugs(await readFile(target, 'utf8'))
      const fragment = decodeURIComponent(rawFragment).toLowerCase()
      if (!slugs.has(fragment)) {
        failures.push(`${file}:${index + 1}: missing heading ${reference}`)
      }
    }
  }
}

if (failures.length > 0) {
  console.error('documentation link check failed:')
  for (const failure of failures) console.error(` - ${failure}`)
  process.exit(1)
}

console.log(`documentation links OK — ${files.length} Markdown files checked.`)
