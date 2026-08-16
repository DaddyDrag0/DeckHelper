import { auraPackRangeForMedian, auraPacksForDepth, depthsRewardStageAttack, estimatedDepthRange } from '../src/engine/depths-rewards'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

assert(depthsRewardStageAttack(1) === 39, 'StageATK floor 1 mismatch')
assert(depthsRewardStageAttack(100) === 2242, 'StageATK floor 100 mismatch')
assert(auraPacksForDepth(1) === 1, 'Aura Packs floor 1 mismatch')
assert(auraPacksForDepth(100) === 249, 'Aura Packs floor 100 mismatch')
const range = estimatedDepthRange(13334)
assert(range.low === 11334 && range.high === 15334, '15% estimated range mismatch: ' + JSON.stringify(range))
const reward = auraPackRangeForMedian(13334)
assert(reward.auraPackLow === 7464783, 'Low Aura Pack reward mismatch: ' + reward.auraPackLow)
assert(reward.auraPackHigh === 10992783, 'High Aura Pack reward mismatch: ' + reward.auraPackHigh)
console.log('Depths reward regression passed:', reward)
