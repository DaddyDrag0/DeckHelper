import fs from 'node:fs'

const source = fs.readFileSync('src/optimizer/search.ts', 'utf8')
if (source.includes('COMMON_SEEDS')) throw new Error('Fixed optimizer seed pool returned')
if (!source.includes('function makeSearchSeeds')) throw new Error('Fresh search seed generator missing')
if (!source.includes('simulateDepthsBatch')) throw new Error('Finalists must use exact sequential Depths batches')
if (!source.includes('battleTurnCap: 10_000')) throw new Error('Final Depths batch must match the calculator turn cap')
if (!source.includes('batch.runs.map((run) => run.deathFloor)')) throw new Error('Final metrics must use actual first-loss death floors')
if ((source.match(/const searchSeeds = makeSearchSeeds/g) || []).length !== 2) throw new Error('Each top-level optimizer operation must create one shared fresh pruning seed set')
for (const hook of ['const finalBatchSeed = makeSearchSeeds(1)[0]', 'settings.finalSeedCount,\n      [finalBatchSeed]', 'DEEP_RECHECK_SEED_COUNT = 29']) {
  if (!source.includes(hook)) throw new Error(`Shared finalist benchmark hook missing: ${hook}`)
}
if (source.includes('const finalistSeeds = makeSearchSeeds(settings.finalSeedCount)')) throw new Error('Finalists should not receive different random enemy samples')
console.log('Depths seed regression passed: fresh shared pruning seeds + paired exact finalist seeds.')
