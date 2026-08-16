import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

const manifestPath = new URL('../engine-source-manifest.json', import.meta.url)
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
const failures = []

for (const [path, expected] of Object.entries(manifest.files ?? {})) {
  let content
  try {
    content = await readFile(new URL(`../${path}`, import.meta.url))
  } catch {
    failures.push(`${path}: missing`)
    continue
  }
  const actual = createHash('sha256').update(content).digest('hex')
  if (actual !== expected) failures.push(`${path}: expected ${expected}, got ${actual}`)
}

if (failures.length) {
  console.error(`Copied simulator drifted from ${manifest.sourceRepository}@${manifest.sourceCommit}`)
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log(`Verified ${Object.keys(manifest.files ?? {}).length} copied simulator files from ${manifest.sourceRepository}@${manifest.sourceCommit}.`)
