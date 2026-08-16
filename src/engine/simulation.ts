import type { BattleDebug, TeamLoadout } from '../types'
import { generateDepthsTeam } from './depths'
import { SeededRng } from './rng'
import { simulateBattleV2 } from './battle-v2'
import { auraPackRangeForMedian } from './depths-rewards'
import { estimateDepthClearSeconds } from './depths-time'

export interface DepthsRunResult {
  deathFloor: number
  floorsCleared: number
  battles: number
  totalTurns: number
  endingEnemies: string[]
  trusted: boolean
  unsupportedAbilities: string[]
  runSeed: number
  floorSeed?: number
  battleSeed?: number
  turnLimitReached?: boolean
  turnLimitEnemy?: string
  turnLimitAlly?: string
  debug?: BattleDebug
}

export interface DepthsBatchResult {
  runs: DepthsRunResult[]
  averageFloor: number
  medianFloor: number
  minFloor: number
  maxFloor: number
  estimatedFloorLow: number
  estimatedFloorHigh: number
  auraPackLow: number
  auraPackMedian: number
  auraPackHigh: number
  averageTurnsPerBattle: number
  estimatedSecondsLow: number
  estimatedSecondsMedian: number
  estimatedSecondsHigh: number
  auraCardsPerHour: number
  trusted: boolean
  unsupportedAbilities: string[]
}

export interface DepthsSimulationOptions {
  startFloor?: number
  floorCap?: number
  seed?: number
  battleTurnCap?: number
  throwOnBattleTurnCap?: boolean
}

export interface DepthsBatchOptions extends DepthsSimulationOptions {
  runs?: number
}

export type DepthsProgressCallback = (floor: number, battleTurn?: number, enemyNames?: string[]) => void

function mixSeed(runSeed: number, floor: number): number {
  let x = (runSeed ^ Math.imul(floor, 0x9e3779b1)) >>> 0
  x ^= x >>> 16
  x = Math.imul(x, 0x85ebca6b) >>> 0
  x ^= x >>> 13
  x = Math.imul(x, 0xc2b2ae35) >>> 0
  return (x ^ (x >>> 16)) >>> 0
}

/** Every Depth floor starts a new full battle with a fresh copy of the selected team. */
export function simulateDepthsRun(
  loadout: TeamLoadout,
  options: DepthsSimulationOptions = {},
  onProgress?: DepthsProgressCallback,
): DepthsRunResult {
  const startFloor = Math.max(1, Math.floor(options.startFloor ?? 1))
  const floorCap = Math.max(startFloor, Math.floor(options.floorCap ?? 50_000))
  const runSeed = options.seed ?? 1
  const unsupported = new Set<string>()
  let totalTurns = 0
  let battles = 0

  for (let floor = startFloor; floor <= floorCap; floor++) {
    const floorSeed = mixSeed(runSeed, floor)
    const enemies = generateDepthsTeam(floor, floorSeed)
    const enemyNames = enemies.map((enemy) => enemy.card.name)
    onProgress?.(floor, undefined, enemyNames)
    const hasTurnCap = Number.isFinite(options.battleTurnCap)
    const maxTurns = hasTurnCap ? Math.max(1, Math.floor(options.battleTurnCap as number)) : Number.POSITIVE_INFINITY
    const battle = simulateBattleV2(
      loadout, enemies, floorSeed ^ 0x51ed270b, maxTurns, hasTurnCap, false,
      (battleTurn) => onProgress?.(floor, battleTurn, enemyNames),
    )
    battles += 1
    totalTurns += battle.turns
    for (const ability of battle.unsupportedAbilities) unsupported.add(ability)

    if (options.throwOnBattleTurnCap && battle.unsupportedAbilities.includes('Battle turn cap reached')) {
      const battleSeed = floorSeed ^ 0x51ed270b
      throw new Error(
        `Long battle diagnostic: floor ${floor.toLocaleString('en-US')} reached ${maxTurns.toLocaleString('en-US')} turns vs ${enemyNames.join(' | ')}. ` +
        `Run seed ${runSeed}; floor seed ${floorSeed}; battle seed ${battleSeed}.`,
      )
    }

    if (battle.winner !== 'Allies') {
      // Re-run only the losing battle with tracing enabled. This keeps thousands of
      // winning floors fast while still making the exact loss fully inspectable.
      const debugBattle = simulateBattleV2(
        loadout, enemies, floorSeed ^ 0x51ed270b, maxTurns, hasTurnCap, true,
        (battleTurn) => onProgress?.(floor, battleTurn, enemyNames),
      )
      onProgress?.(floor, undefined, enemyNames)
      return {
        deathFloor: floor,
        floorsCleared: floor - startFloor,
        battles,
        totalTurns,
        endingEnemies: enemies.map((enemy) => enemy.card.name),
        trusted: unsupported.size === 0,
        unsupportedAbilities: [...unsupported].sort(),
        runSeed,
        floorSeed,
        battleSeed: floorSeed ^ 0x51ed270b,
        turnLimitReached: debugBattle.turnLimitReached,
        turnLimitEnemy: debugBattle.debug?.turnLimit?.enemy,
        turnLimitAlly: debugBattle.debug?.turnLimit?.ally,
        debug: debugBattle.debug,
      }
    }
  }

  onProgress?.(floorCap)
  return {
    deathFloor: floorCap + 1,
    floorsCleared: floorCap - startFloor + 1,
    battles,
    totalTurns,
    endingEnemies: [],
    trusted: unsupported.size === 0,
    unsupportedAbilities: [...unsupported].sort(),
    runSeed,
  }
}

export function simulateDepthsBatch(
  loadout: TeamLoadout,
  options: DepthsBatchOptions = {},
): DepthsBatchResult {
  const runs = Math.max(1, Math.floor(options.runs ?? 15))
  const seed = options.seed ?? 1
  const seedRng = new SeededRng(seed)
  const results: DepthsRunResult[] = []
  const unsupported = new Set<string>()

  for (let index = 0; index < runs; index++) {
    const runSeed = Math.floor(seedRng.next() * 0x7fffffff) || index + 1
    const result = simulateDepthsRun(loadout, {
      startFloor: options.startFloor,
      floorCap: options.floorCap,
      seed: runSeed,
      battleTurnCap: options.battleTurnCap,
    })
    results.push(result)
    for (const ability of result.unsupportedAbilities) unsupported.add(ability)
  }

  const floors = results.map((result) => result.deathFloor).sort((a, b) => a - b)
  const middle = Math.floor(floors.length / 2)
  const medianFloor = floors.length % 2
    ? floors[middle]
    : (floors[middle - 1] + floors[middle]) / 2
  const estimate = auraPackRangeForMedian(medianFloor)
  const totalBattles = results.reduce((sum, result) => sum + result.battles, 0)
  const allTurns = results.reduce((sum, result) => sum + result.totalTurns, 0)
  const averageTurnsPerBattle = totalBattles > 0 ? allTurns / totalBattles : 0
  const estimatedSecondsLow = estimateDepthClearSeconds(estimate.low, averageTurnsPerBattle, true)
  const estimatedSecondsMedian = estimateDepthClearSeconds(estimate.medianDepth, averageTurnsPerBattle, true)
  const estimatedSecondsHigh = estimateDepthClearSeconds(estimate.high, averageTurnsPerBattle, true)
  const auraCardsPerHour = estimatedSecondsMedian > 0 ? estimate.auraPackMedian / (estimatedSecondsMedian / 3600) : 0

  return {
    runs: results,
    averageFloor: floors.reduce((sum, floor) => sum + floor, 0) / floors.length,
    medianFloor,
    minFloor: floors[0],
    maxFloor: floors[floors.length - 1],
    estimatedFloorLow: estimate.low,
    estimatedFloorHigh: estimate.high,
    auraPackLow: estimate.auraPackLow,
    auraPackMedian: estimate.auraPackMedian,
    auraPackHigh: estimate.auraPackHigh,
    averageTurnsPerBattle,
    estimatedSecondsLow,
    estimatedSecondsMedian,
    estimatedSecondsHigh,
    auraCardsPerHour,
    trusted: unsupported.size === 0,
    unsupportedAbilities: [...unsupported].sort(),
  }
}
