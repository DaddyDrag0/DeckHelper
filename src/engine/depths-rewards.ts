/**
 * Depths reward helpers recovered from the game sources.
 *
 * Card RNG Expansion keeps this Util.StageATK helper:
 *   ceil(calculateA(3000 + floor^2.7 * 40, 1) / 2)
 * and calculateA(x, 1) = sqrt(x / 2) * 2, so StageATK simplifies to:
 *   ceil(sqrt((3000 + floor^2.7 * 40) / 2))
 *
 * Aura Pack rewards are cumulative. The per-floor reward scales through floor
 * 5,000, then stays at the floor-5,000 amount for every later floor.
 */
export const AURA_PACK_SCALING_CAP_FLOOR = 5000

export function depthsRewardStageAttack(floor: number): number {
  const safeFloor = Math.max(1, Math.floor(Number(floor) || 1))
  return Math.ceil(Math.sqrt((3000 + Math.pow(safeFloor, 2.7) * 40) / 2))
}

export function auraPacksForDepth(depth: number): number {
  const endFloor = Math.max(0, Math.floor(Number(depth) || 0))
  if (endFloor <= 0) return 0

  const scalingEnd = Math.min(endFloor, AURA_PACK_SCALING_CAP_FLOOR)
  let packs = 0
  for (let floor = 1; floor <= scalingEnd; floor++) {
    packs += Math.ceil(depthsRewardStageAttack(floor) / 500)
  }

  if (endFloor > AURA_PACK_SCALING_CAP_FLOOR) {
    const cappedPacksPerFloor = Math.ceil(depthsRewardStageAttack(AURA_PACK_SCALING_CAP_FLOOR) / 500)
    packs += (endFloor - AURA_PACK_SCALING_CAP_FLOOR) * cappedPacksPerFloor
  }

  return packs
}

export function estimatedDepthRange(medianFloor: number, margin = 0.15): { low: number; high: number } {
  const median = Math.max(1, Number(medianFloor) || 1)
  const safeMargin = Math.max(0, Number(margin) || 0)
  return {
    low: Math.max(1, Math.round(median * (1 - safeMargin))),
    high: Math.max(1, Math.round(median * (1 + safeMargin))),
  }
}

export function auraPackRangeForMedian(medianFloor: number, margin = 0.15) {
  const range = estimatedDepthRange(medianFloor, margin)
  const medianDepth = Math.max(1, Math.round(Number(medianFloor) || 1))
  return {
    ...range,
    medianDepth,
    auraPackLow: auraPacksForDepth(range.low),
    auraPackMedian: auraPacksForDepth(medianDepth),
    auraPackHigh: auraPacksForDepth(range.high),
  }
}
