#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (file) => readFileSync(path.join(root, file), 'utf8')
const pkg = JSON.parse(read('package.json'))
const version = pkg.version
const errors = []

function markerVersion(file) {
  const source = read(file)
  return source.match(
    /\*\*(?:Release version|Portfolio Version|Product Version|Version):\*\*\s*`?v?([0-9]+\.[0-9]+\.[0-9]+)[^`\n]*/,
  )?.[1]
}

if (!version) errors.push('package.json missing version')

if (existsSync(path.join(root, 'package-lock.json'))) {
  const lock = JSON.parse(read('package-lock.json'))
  if (lock.version !== version) {
    errors.push(`package-lock.json version ${lock.version} != package.json ${version}`)
  }
  if (lock.packages?.['']?.version !== version) {
    errors.push(`package-lock packages[""].version ${lock.packages?.['']?.version} != ${version}`)
  }
}

for (const file of ['README.md']) {
  const found = markerVersion(file)
  if (!found) errors.push(`${file} missing **Version:** vX.Y.Z marker`)
  else if (found !== version) errors.push(`${file} version ${found} != package.json ${version}`)
}

if (pkg.name === 'fair-point') {
  const nvm = read('.nvmrc').trim()
  const workflow = read('.github/workflows/verify.yml')
  const ciNode = workflow.match(/node-version:\s*['"]?([^'"\s]+)['"]?/)?.[1]
  if (pkg.engines?.node !== '22.22.x') {
    errors.push(`package.json engines.node ${pkg.engines?.node} != 22.22.x`)
  }
  if (nvm !== '22.22.2') errors.push(`.nvmrc ${nvm} != 22.22.2`)
  if (ciNode !== '22.22.x') errors.push(`verify.yml node-version ${ciNode ?? 'missing'} != 22.22.x`)
}

if (errors.length) {
  console.error('version-coherence FAILED:')
  for (const error of errors) console.error(` - ${error}`)
  process.exit(1)
}

console.log(`version-coherence OK — ${version}`)
