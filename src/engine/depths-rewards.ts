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

export const POTION_DROP_CAP_FLOOR = 5000
export const BOUNTIFUL_DEPTHS_DROP_MULTIPLIER = 1.25
export const JACKPOT_POTION_BASE_ODDS = 400
export const JACKPOT_POTION_CAP_ODDS = 170
export const RARE_WEATHER_POTION_BASE_ODDS = 8000
export const RARE_WEATHER_POTION_CAP_ODDS = 3403

export interface PotionDropStat {
  expected: number
  atLeastOne: number
  oneInRuns: number
  endFloorOneIn: number
}

export interface PotionDropSummary {
  depth: number
  bountiful: boolean
  jackpot: PotionDropStat
  rareWeather: PotionDropStat
}

function withBountiful(chance: number, bountiful: boolean): number {
  return Math.min(1, Math.max(0, chance * (bountiful ? BOUNTIFUL_DEPTHS_DROP_MULTIPLIER : 1)))
}

/**
 * Jackpot Potion starts at 1/400 and reaches 1/170 at floor 5,000.
 * The reward table only gives the endpoints, so the calculator applies the
 * stated flat per-floor improvement linearly between those two chances.
 */
export function jackpotPotionChanceForFloor(floor: number, bountiful = false): number {
  const safeFloor = Math.max(1, Math.floor(Number(floor) || 1))
  const progress = Math.min(1, Math.max(0, (safeFloor - 1) / (POTION_DROP_CAP_FLOOR - 1)))
  const baseChance = 1 / JACKPOT_POTION_BASE_ODDS
  const capChance = 1 / JACKPOT_POTION_CAP_ODDS
  return withBountiful(baseChance + (capChance - baseChance) * progress, bountiful)
}

/**
 * Current reward-table figures use a 1/8,000 Rare Weather roll during the
 * 1-5,000 full run, then the capped 1/3,403 per-floor roll at floor 5,000+.
 * This reproduces the published ~1 in 2.15 full-run figure, or ~1 in 1.84
 * with Bountiful Depths (+25% drop chance).
 */
export function rareWeatherPotionChanceForFloor(floor: number, bountiful = false): number {
  const safeFloor = Math.max(1, Math.floor(Number(floor) || 1))
  const baseChance = safeFloor >= POTION_DROP_CAP_FLOOR
    ? 1 / RARE_WEATHER_POTION_CAP_ODDS
    : 1 / RARE_WEATHER_POTION_BASE_ODDS
  return withBountiful(baseChance, bountiful)
}

function summarizePotionDrops(
  depth: number,
  chanceForFloor: (floor: number, bountiful: boolean) => number,
  bountiful: boolean,
): PotionDropStat {
  const endFloor = Math.max(0, Math.floor(Number(depth) || 0))
  if (endFloor <= 0) return { expected: 0, atLeastOne: 0, oneInRuns: Infinity, endFloorOneIn: Infinity }

  const scalingEnd = Math.min(endFloor, POTION_DROP_CAP_FLOOR)
  let expected = 0
  let logNoDrop = 0
  for (let floor = 1; floor <= scalingEnd; floor++) {
    const chance = chanceForFloor(floor, bountiful)
    expected += chance
    logNoDrop += Math.log1p(-chance)
  }

  if (endFloor > POTION_DROP_CAP_FLOOR) {
    const extraFloors = endFloor - POTION_DROP_CAP_FLOOR
    const cappedChance = chanceForFloor(POTION_DROP_CAP_FLOOR + 1, bountiful)
    expected += extraFloors * cappedChance
    logNoDrop += extraFloors * Math.log1p(-cappedChance)
  }

  const atLeastOne = Math.min(1, Math.max(0, 1 - Math.exp(logNoDrop)))
  const endFloorChance = chanceForFloor(endFloor, bountiful)
  return {
    expected,
    atLeastOne,
    oneInRuns: atLeastOne > 0 ? 1 / atLeastOne : Infinity,
    endFloorOneIn: endFloorChance > 0 ? 1 / endFloorChance : Infinity,
  }
}

export function potionDropsForDepth(depth: number, bountiful = false): PotionDropSummary {
  const safeDepth = Math.max(0, Math.floor(Number(depth) || 0))
  return {
    depth: safeDepth,
    bountiful,
    jackpot: summarizePotionDrops(safeDepth, jackpotPotionChanceForFloor, bountiful),
    rareWeather: summarizePotionDrops(safeDepth, rareWeatherPotionChanceForFloor, bountiful),
  }
}

export function potionDropRangeForMedian(medianFloor: number, margin = 0.15, bountiful = false) {
  const range = estimatedDepthRange(medianFloor, margin)
  const medianDepth = Math.max(1, Math.round(Number(medianFloor) || 1))
  return {
    ...range,
    medianDepth,
    bountiful,
    low: potionDropsForDepth(range.low, bountiful),
    median: potionDropsForDepth(medianDepth, bountiful),
    high: potionDropsForDepth(range.high, bountiful),
  }
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
