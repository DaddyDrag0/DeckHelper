import fs from 'node:fs'

const source = fs.readFileSync('src/optimizer/search.ts', 'utf8')
if (source.includes('COMMON_SEEDS')) throw new Error('Fixed optimizer seed pool returned')
if (!source.includes('function makeSearchSeeds')) throw new Error('Fresh search seed generator missing')
if ((source.match(/const searchSeeds = makeSearchSeeds/g) || []).length !== 2) throw new Error('Each top-level optimizer operation must create one shared fresh seed set')
for (const hook of ['seeds.slice(0, 3)', '[seeds[index % seeds.length]]', 'const finalistSeeds = makeSearchSeeds(settings.finalSeedCount)', 'settings.finalSeedCount, finalistSeeds']) {
  if (!source.includes(hook)) throw new Error(`Fresh/random seed hook missing: ${hook}`)
}
if (source.includes("Running final shared-seed measurements")) throw new Error('Finalists should not reuse one shared enemy sequence')
console.log('Fresh Depths seed regression passed: shared pruning seeds + independent finalist seeds.')
