import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** Ensure every source and intra-spec section citation resolves to a real heading. */
const SPEC = 'docs/MATH-SPEC.md'
const SELF = path.relative(process.cwd(), fileURLToPath(import.meta.url))
const ROOTS = ['src', 'scripts', 'tests']
const EXTENSIONS = new Set(['.ts', '.tsx', '.mjs', '.js', '.css'])

// Source comments cite the spec as a bare `§6.5.1`, not as a repeated path, so
// that is the form this scans for. The trailing lookahead keeps statutory
// citations out of the net: `IRC §409A` is a law, not a spec heading, and no
// spec heading ends in an alphanumeric beyond the optional lowercase suffix.
// A trailing `.` is allowed so a citation ending a sentence still counts.
const CITATION = /§(\d+(?:\.\d+)*[a-z]?)(?![A-Za-z0-9])/g

async function filesUnder(directory) {
  let entries
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch (error) {
    if (error?.code === 'ENOENT') return []
    throw error
  }
  const nested = await Promise.all(
    entries.map((entry) => {
      const filePath = path.join(directory, entry.name)
      return entry.isDirectory() ? filesUnder(filePath) : Promise.resolve([filePath])
    }),
  )
  return nested.flat()
}

const specHeadings = new Set()
let specFence = null
for (const line of (await readFile(SPEC, 'utf8')).split('\n')) {
  const marker = /^\s*(`{3,}|~{3,})/u.exec(line)?.[1]
  if (marker !== undefined) {
    if (specFence === null) specFence = marker[0]
    else if (marker[0] === specFence) specFence = null
    continue
  }
  if (specFence !== null) continue
  const heading = /^#{1,6}\s+(\d+(?:\.\d+)*[a-z]?)/.exec(line)
  if (heading) specHeadings.add(heading[1])
}
if (specHeadings.size === 0) {
  console.error(`citation check failed: no numbered headings found in ${SPEC}.`)
  process.exit(1)
}

const files = (await Promise.all(ROOTS.map(filesUnder)))
  .flat()
  .filter((file) => EXTENSIONS.has(path.extname(file)) && path.normalize(file) !== SELF)

const unresolved = []
let citations = 0

for (const file of files) {
  const content = await readFile(file, 'utf8')
  content.split('\n').forEach((line, index) => {
    for (const match of line.matchAll(CITATION)) {
      citations += 1
      if (!specHeadings.has(match[1])) {
        unresolved.push(`${file}:${index + 1}: §${match[1]} is not a heading in ${SPEC}`)
      }
    }
  })
}

const spec = await readFile(SPEC, 'utf8')
specFence = null
spec.split('\n').forEach((line, index) => {
  const marker = /^\s*(`{3,}|~{3,})/u.exec(line)?.[1]
  if (marker !== undefined) {
    if (specFence === null) specFence = marker[0]
    else if (marker[0] === specFence) specFence = null
    return
  }
  if (specFence !== null) return
  for (const match of line.matchAll(CITATION)) {
    if (!specHeadings.has(match[1])) {
      unresolved.push(`${SPEC}:${index + 1}: §${match[1]} is not a heading in ${SPEC}`)
    }
  }
})

if (unresolved.length > 0) {
  console.error('citation check failed.')
  console.error(`\n${unresolved.length} citation(s) name a section that does not exist:`)
  for (const hit of unresolved) console.error(` - ${hit}`)
  console.error('\nEither add the section to the spec or cite the one that governs.')
  process.exit(1)
}

if (citations === 0) {
  console.error(`citation check failed: no § citation found across ${files.length} source files.`)
  console.error('Source comments cite the spec by section; a scan that finds none is not a check.')
  process.exit(1)
}

console.log(
  `citations OK — ${citations} source citations across ${files.length} files, plus ${SPEC} itself; every § citation resolves (${specHeadings.size} numbered headings).`,
)
