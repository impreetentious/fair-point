#!/usr/bin/env node
/**
 * Enforces a Lighthouse accessibility score of at least 90 against the static export.
 */
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const lighthouse = require('lighthouse').default ?? require('lighthouse')
const chromeLauncher = require('chrome-launcher')

const PORT = 4173
const TARGET_URL = `http://127.0.0.1:${PORT}/`
const THRESHOLD = 90
const servePath = fileURLToPath(new URL('../node_modules/serve/build/main.js', import.meta.url))

async function waitForServer(url, attempts = 40) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const response = await fetch(url)
      if (response.ok) return
    } catch {
      /* retry */
    }
    await delay(250)
  }
  throw new Error(`Static export did not become ready at ${url}`)
}

const server = spawn(
  process.execPath,
  [
    servePath,
    '-l',
    `tcp://127.0.0.1:${PORT}`,
    '--no-port-switching',
    '--config',
    '../serve.json',
    'out',
  ],
  {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
  },
)

let chrome
try {
  await waitForServer(TARGET_URL)
  chrome = await chromeLauncher.launch({
    chromeFlags: ['--headless', '--no-sandbox', '--disable-gpu'],
  })
  const result = await lighthouse(TARGET_URL, {
    port: chrome.port,
    output: 'json',
    onlyCategories: ['accessibility'],
    formFactor: 'desktop',
    screenEmulation: { disabled: true },
  })
  const score = Math.round((result.lhr.categories.accessibility.score ?? 0) * 100)
  const audits = Object.values(result.lhr.audits)
    .filter(
      (audit) =>
        audit.score !== null && audit.score < 1 && audit.scoreDisplayMode !== 'notApplicable',
    )
    .map((audit) => `  - ${audit.id}: ${audit.title} (score ${audit.score})`)
  console.log(`Lighthouse accessibility: ${score}/100 (threshold ${THRESHOLD})`)
  if (audits.length > 0) {
    console.log('Failed / partial a11y audits:')
    console.log(audits.join('\n'))
  }
  if (score < THRESHOLD) {
    process.exitCode = 1
    console.error(`FAIL: accessibility score ${score} is below ${THRESHOLD}`)
  } else {
    console.log('PASS')
  }
} finally {
  if (chrome !== undefined) await chrome.kill()
  server.kill('SIGTERM')
}
