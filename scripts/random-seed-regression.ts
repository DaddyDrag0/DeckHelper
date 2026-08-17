import fs from 'node:fs'

const source = fs.readFileSync('src/optimizer/search.ts', 'utf8')
if (source.includes('COMMON_SEEDS')) throw new Error('Fixed optimizer seed pool returned')
if (!source.includes('function makeSearchSeeds')) throw new Error('Fresh search seed generator missing')
if ((source.match(/const searchSeeds = makeSearchSeeds/g) || []).length !== 2) throw new Error('Each top-level optimizer operation must create one shared fresh seed set')
for (const hook of ['seeds.slice(0, 3)', '[seeds[index % seeds.length]]', 'settings.finalSeedCount, searchSeeds']) {
  if (!source.includes(hook)) throw new Error(`Fresh/shared seed hook missing: ${hook}`)
}
console.log('Fresh Depths seed regression passed.')
