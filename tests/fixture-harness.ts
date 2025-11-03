import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { load } from 'js-yaml'
import { FixtureSchema, type Fixture } from '../src/core/schema'

export type FixtureHandler = (fixture: Fixture) => void | Promise<void>
type DisputedFixture = Fixture & { disputed?: boolean }

const handlers = new Map<Fixture['kind'], FixtureHandler>()

export function registerFixtureHandler(kind: Fixture['kind'], handler: FixtureHandler): void {
  handlers.set(kind, handler)
}

function walk(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = resolve(directory, entry.name)
    if (entry.isDirectory()) return walk(fullPath)
    return entry.isFile() && /\.ya?ml$/i.test(entry.name) ? [fullPath] : []
  })
}

export function discoverFixtureFiles(root = resolve(process.cwd(), 'fixtures')): string[] {
  try {
    return walk(root).sort()
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return []
    throw error
  }
}

export function loadFixtures(root?: string): { path: string; fixture: Fixture }[] {
  return discoverFixtureFiles(root).map((path) => {
    const parsed = FixtureSchema.parse(load(readFileSync(path, 'utf8')))
    if (
      parsed.id !==
      path
        .split('/')
        .at(-1)
        ?.replace(/\.ya?ml$/i, '')
    ) {
      throw new Error(`Fixture id '${parsed.id}' must match filename '${path.split('/').at(-1)}'.`)
    }
    return { path, fixture: parsed }
  })
}

export async function dispatchFixture(fixture: Fixture): Promise<void> {
  const handler = handlers.get(fixture.kind)
  if (handler === undefined)
    throw new Error(`No fixture handler is registered for ${fixture.kind} (${fixture.id}).`)
  await handler(fixture)
}

export async function runFixtureHarness(
  root?: string,
): Promise<{ id: string; status: 'PASS' | 'DISPUTED' }[]> {
  const fixtures = loadFixtures(root)
  const results: { id: string; status: 'PASS' | 'DISPUTED' }[] = []
  for (const { fixture } of fixtures) {
    if ((fixture as DisputedFixture).disputed === true) {
      results.push({ id: fixture.id, status: 'DISPUTED' })
      continue
    }
    await dispatchFixture(fixture)
    results.push({ id: fixture.id, status: 'PASS' })
  }
  return results
}
