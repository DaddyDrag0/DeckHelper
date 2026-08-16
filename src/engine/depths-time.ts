/**
 * Source-aligned Depths playback speed model recovered from Expansion BattleClient.
 *
 * In Depths, the user's normal BattleSpeed setting is capped at 3.
 * Chrono Shard adds +1 Battle Speed.
 * Every 100 Depths floors adds +0.25 Battle Speed, capped at +4.5.
 *
 * BattleClient also accelerates long fights by multiplying animation speed after
 * the 10th/20th/40th/60th Attack event by 2x/3x/5x/10x respectively.
 *
 * The Depths loop also waits on the player's `battlecd` attribute after every
 * battle before requesting the next floor. The client does not contain the
 * server-side duration for that attribute, so INTER_FLOOR_OVERHEAD_SECONDS is
 * calibrated from observed live runs: ~13k floors in ~12h and ~22k in ~20h,
 * both landing near 3.3 seconds per floor overall once combat animation is included.
 *
 * We approximate a normal attack animation as 1.1 seconds at 1x speed from the
 * main attack path (0.1 approach + 0.3 hit pause + 0.2 return + 0.5 settle), plus
 * a 0.5-second battle-start settle. Ability-specific animation waits are not yet
 * modeled individually and can still add some variance.
 */
export const DEPTHS_BASE_BATTLE_SPEED = 3
export const CHRONO_SHARD_BONUS = 1
export const DEPTHS_FLOOR_SPEED_STEP = 0.25
export const DEPTHS_FLOOR_SPEED_STEP_FLOORS = 100
export const DEPTHS_FLOOR_SPEED_BONUS_CAP = 4.5
export const BASE_ATTACK_ANIMATION_SECONDS = 1.1
export const BASE_BATTLE_START_SECONDS = 0.5
export const INTER_FLOOR_OVERHEAD_SECONDS = 2

export function depthsFloorSpeedBonus(floor: number): number {
  const safeFloor = Math.max(1, Math.floor(Number(floor) || 1))
  return Math.min(
    DEPTHS_FLOOR_SPEED_BONUS_CAP,
    Math.floor(safeFloor / DEPTHS_FLOOR_SPEED_STEP_FLOORS) * DEPTHS_FLOOR_SPEED_STEP,
  )
}

export function effectiveDepthsBattleSpeed(floor: number, chronoShard = true): number {
  return DEPTHS_BASE_BATTLE_SPEED
    + (chronoShard ? CHRONO_SHARD_BONUS : 0)
    + depthsFloorSpeedBonus(floor)
}

export function inBattleAcceleration(attackNumber: number): number {
  const attack = Math.max(1, Math.floor(Number(attackNumber) || 1))
  if (attack >= 60) return 10
  if (attack >= 40) return 5
  if (attack >= 20) return 3
  if (attack >= 10) return 2
  return 1
}

function attackAnimationSecondsForCount(turns: number, effectiveSpeed: number): number {
  const count = Math.max(0, Number(turns) || 0)
  const whole = Math.floor(count)
  const fractional = count - whole
  let seconds = 0
  for (let attack = 1; attack <= whole; attack++) {
    seconds += BASE_ATTACK_ANIMATION_SECONDS / (effectiveSpeed * inBattleAcceleration(attack))
  }
  if (fractional > 0) {
    seconds += fractional * BASE_ATTACK_ANIMATION_SECONDS / (effectiveSpeed * inBattleAcceleration(whole + 1))
  }
  return seconds
}

export function estimateBattleSeconds(floor: number, turns: number, chronoShard = true): number {
  const speed = effectiveDepthsBattleSpeed(floor, chronoShard)
  return INTER_FLOOR_OVERHEAD_SECONDS
    + BASE_BATTLE_START_SECONDS / speed
    + attackAnimationSecondsForCount(turns, speed)
}

/** Estimate a full run using the batch's observed average turns per battle. */
export function estimateDepthClearSeconds(depth: number, averageTurnsPerBattle: number, chronoShard = true): number {
  const endFloor = Math.max(0, Math.floor(Number(depth) || 0))
  const avgTurns = Math.max(0, Number(averageTurnsPerBattle) || 0)
  let seconds = 0
  for (let floor = 1; floor <= endFloor; floor++) {
    seconds += estimateBattleSeconds(floor, avgTurns, chronoShard)
  }
  return seconds
}

export function formatDurationParts(seconds: number): { hours: number; minutes: number; seconds: number } {
  const whole = Math.max(0, Math.round(Number(seconds) || 0))
  return {
    hours: Math.floor(whole / 3600),
    minutes: Math.floor((whole % 3600) / 60),
    seconds: whole % 60,
  }
}
