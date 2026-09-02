import { auraPackRangeForMedian, auraPacksForDepth } from '../src/engine/depths-rewards'
import { battleSpeedStructureBonus, depthsFloorSpeedBonus, effectiveDepthsBattleSpeed, estimateBattleSeconds, inBattleAcceleration } from '../src/engine/depths-time'

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message) }
function close(a: number, b: number, eps = 1e-9) { return Math.abs(a - b) <= eps }

assert(effectiveDepthsBattleSpeed(1, true) === 4, 'Floor 1 Battle Speed should be 3 + Chrono 1')
assert(effectiveDepthsBattleSpeed(100, true) === 4.25, 'Floor 100 Battle Speed should include +0.25')
assert(battleSpeedStructureBonus(7) === 1.75, 'Max Battle Speed structure should add +1.75')
assert(effectiveDepthsBattleSpeed(1, true, 7) === 5.75, 'Max structure Battle Speed mismatch')
assert(depthsFloorSpeedBonus(1800) === 4.5, 'Depths floor Battle Speed bonus should cap at +4.5')
assert(effectiveDepthsBattleSpeed(5000, true) === 8.5, 'High-floor Battle Speed should cap at 8.5 with Chrono')
assert(inBattleAcceleration(9) === 1 && inBattleAcceleration(10) === 2, '10-attack acceleration mismatch')
assert(inBattleAcceleration(20) === 3 && inBattleAcceleration(40) === 5 && inBattleAcceleration(60) === 10, 'Long-battle acceleration mismatch')
assert(close(estimateBattleSeconds(1, 1, true), 1.3), 'One-turn floor 1 battle timing mismatch')
assert(effectiveDepthsBattleSpeed(1, false) === 3, 'Floor 1 Battle Speed without Chrono should be 3')
assert(estimateBattleSeconds(1, 1, false) > estimateBattleSeconds(1, 1, true), 'Chrono Shard should reduce estimated battle time')
assert(auraPacksForDepth(5001) - auraPacksForDepth(5000) === 882, 'Aura Pack reward should stay capped after floor 5000')
assert(auraPacksForDepth(22000) === 16872195, 'Aura Pack 22k capped reward mismatch')
const reward = auraPackRangeForMedian(13334)
assert(reward.medianDepth === 13334, 'Median depth mismatch')
assert(reward.auraPackLow === 7464783, 'Low Aura Pack mismatch')
assert(reward.auraPackMedian === 9228783, 'Median Aura Pack mismatch')
assert(reward.auraPackHigh === 10992783, 'High Aura Pack mismatch')
console.log('Depths speed/reward regression passed:', reward)
