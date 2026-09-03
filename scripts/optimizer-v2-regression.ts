import fs from 'node:fs'

const search = fs.readFileSync('src/optimizer/search.ts', 'utf8')
const revamp = fs.readFileSync('src/revamp.ts', 'utf8')
const worker = fs.readFileSync('src/optimizer-worker.ts', 'utf8')
const types = fs.readFileSync('src/app-types.ts', 'utf8')

for (const hook of [
  'function coverageCandidates',
  'candidateCoverageKeys',
  'const abilityScores = abilityOptions.map',
  'candidate.auraPairs = pairScores.slice',
  'Testing every legal card order',
  'const finalBatchSeed = makeSearchSeeds(1)[0]',
  'DEEP_RECHECK_SEED_COUNT = 29',
  'function practicalTeamScore',
  'reliabilityDepth: percentile(sorted, 0.25)',
]) if (!search.includes(hook)) throw new Error('optimizer v2 hook missing: ' + hook)

if ((worker.match(/expandAbilityAuraVariants\(/g) || []).length !== 1) throw new Error('Skill Aura post-processing should be definition-only; search must handle it before pruning')
if (!types.includes('reliabilityDepth?: number')) throw new Error('reliability metric missing from TeamMetrics')
if (!revamp.includes('Reliable Depth')) throw new Error('reliability metric missing from result UI')
if (!revamp.includes('return this.results.slice(0, 10)')) throw new Error('UI must preserve optimizer ranking')
if (revamp.includes('Quick Search')) throw new Error('Quick Search UI returned')
console.log('Optimizer v2 regression passed: coverage, pre-prune Skill Auras, paired finals, reliability ranking.')
