import cards from '../data/cards'
import type { DepthsEnemy, TeamLoadout } from '../types'
import { simulateBattleV2 } from './battle-v2'
import { SeededRng } from './rng'

export type TowerDifficulty = 'Normal' | 'Hard' | 'Extreme' | 'Hell' | 'Impossible'

const DIFFICULTY_ID: Record<TowerDifficulty, number> = {
  Normal: 1,
  Hard: 2,
  Extreme: 3,
  Hell: 5,
  Impossible: 6,
}

const CARD_BY_NAME = new Map(cards.map((card) => [card.name, card] as const))

export interface TowerBatchResult {
  runs: number
  wins: number
  losses: number
  draws: number
  winRate: number
  averageTurns: number
  minTurns: number
  maxTurns: number
  trusted: boolean
  unsupportedAbilities: string[]
}

export function towerStagePower(floor: number, difficulty: TowerDifficulty): number {
  const stage = Math.max(1, Math.floor(floor))
  const stageValue = 6_000 + Math.pow(stage, 3) * 50
  const difficultyId = DIFFICULTY_ID[difficulty]
  return Math.ceil(2 * Math.sqrt(stageValue / 2) * Math.pow(4, difficultyId - 1))
}

export function buildTowerEnemies(
  enemyNames: string[],
  floor: number,
  difficulty: TowerDifficulty,
): DepthsEnemy[] {
  if (enemyNames.length !== 4) throw new Error('Tower battles require exactly four enemies.')
  const power = towerStagePower(floor, difficulty)
  return enemyNames.map((name) => {
    const card = CARD_BY_NAME.get(name)
    if (!card) throw new Error(`Unknown Tower enemy: ${name}`)
    // The generated bordered Tower difficulties use the generated HP directly.
    // Normal and Impossible preserve a card's special HP multiplier.
    const preserveHpMultiplier = difficulty === 'Normal' || difficulty === 'Impossible'
    const health = Math.ceil(power * (preserveHpMultiplier ? (card.hpMultiplier || 1) : 1))
    return {
      card,
      power,
      attack: Math.ceil(power / 2),
      health,
    }
  })
}

export function simulateTowerBatch(
  loadout: TeamLoadout,
  enemyNames: string[],
  floor: number,
  difficulty: TowerDifficulty,
  runs = 1_000,
  seed = 1,
  onProgress?: (completed: number, total: number) => void,
): TowerBatchResult {
  const total = Math.min(10_000, Math.max(1, Math.floor(runs)))
  const enemies = buildTowerEnemies(enemyNames, floor, difficulty)
  const seedRng = new SeededRng(seed || 1)
  const unsupported = new Set<string>()
  let wins = 0
  let losses = 0
  let draws = 0
  let totalTurns = 0
  let minTurns = Number.POSITIVE_INFINITY
  let maxTurns = 0

  for (let index = 0; index < total; index++) {
    const battleSeed = Math.floor(seedRng.next() * 0x7fffffff) || index + 1
    const battle = simulateBattleV2(loadout, enemies, battleSeed, 2_000, true, false)
    if (battle.winner === 'Allies') wins += 1
    else if (battle.winner === 'Enemies') losses += 1
    else draws += 1
    totalTurns += battle.turns
    minTurns = Math.min(minTurns, battle.turns)
    maxTurns = Math.max(maxTurns, battle.turns)
    for (const ability of battle.unsupportedAbilities) unsupported.add(ability)
    if ((index + 1) % 25 === 0 || index + 1 === total) onProgress?.(index + 1, total)
  }

  return {
    runs: total,
    wins,
    losses,
    draws,
    winRate: wins / total,
    averageTurns: totalTurns / total,
    minTurns: Number.isFinite(minTurns) ? minTurns : 0,
    maxTurns,
    trusted: unsupported.size === 0,
    unsupportedAbilities: [...unsupported].sort(),
  }
}
