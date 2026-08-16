import cards from '../src/data/cards'
import { simulateBattleV2 } from '../src/engine/battle-v2'
import { simulateDepthsBatch } from '../src/engine/simulation'
import type { DepthsEnemy, TeamLoadout } from '../src/types'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function card(name: string) {
  const found = cards.find((entry) => entry.name === name)
  if (!found) throw new Error(`Missing regression card: ${name}`)
  return found
}

// Erosion should not make a passive-modified normal attack nonlethal.
const marrowEnemy: DepthsEnemy[] = [{ card: card('Marrowclaw'), power: 100, attack: 50, health: 100 }]
const malikBattle = simulateBattleV2(
  { cards: [{ cardName: 'Malik The Sovereign', borders: ['Galaxy'] }] },
  marrowEnemy,
  111,
  100,
  true,
)
assert(malikBattle.winner === 'Allies', `Malik should normally kill Marrowclaw; got ${malikBattle.winner} at T${malikBattle.turns}`)
assert(malikBattle.turns <= 3, `Marrowclaw normal-attack regression took ${malikBattle.turns} turns`)
console.log('Erosion normal-attack regression passed:', malikBattle.turns, 'turns')

// Zombie Dragon's two-turn survival must expire on global combat turns even if
// the opponent chains extra turns and Zombie Dragon never gets to act.
const zombieEnemy: DepthsEnemy[] = [{ card: card('Zombie Dragon'), power: 100, attack: 50, health: 100 }]
const zombieBattle = simulateBattleV2(
  { cards: [{ cardName: 'Priest', borders: ['Galaxy'] }] },
  zombieEnemy,
  222,
  100,
  true,
)
assert(zombieBattle.winner === 'Allies', `Zombie Dragon global lifespan failed; got ${zombieBattle.winner} at T${zombieBattle.turns}`)
assert(zombieBattle.turns < 20, `Zombie Dragon remained alive too long: ${zombieBattle.turns} turns`)
console.log('Zombie Dragon global-turn regression passed:', zombieBattle.turns, 'turns')

// Pandora intentionally draws from the full supported card pool, including limited-card abilities.
// The older limited-only exclusion regression was removed because it contradicted the current engine contract.

// Calibration snapshot for the known Shuten/Desmond/Berserker deck.
const calibration: TeamLoadout = {
  cards: [
    { cardName: 'Fuxi', borders: [] },
    { cardName: 'Shuten-dōji', borders: ['Platinum', 'Galaxy'] },
    { cardName: 'Chronus The Hoarder', borders: ['Platinum', 'Crystal', 'Galaxy'] },
    { cardName: 'Malik The Sovereign', borders: ['Platinum', 'Crystal', 'Galaxy'] },
  ],
  statAura: { auraName: 'Desmond Of Despair', border: 'Galaxy' },
  abilityAura: { auraName: 'Berserker', border: 'Galaxy' },
}
const calibrationResult = simulateDepthsBatch(calibration, {
  runs: 20,
  startFloor: 9000,
  floorCap: 15000,
  seed: 0x51a7cafe,
  battleTurnCap: 10000,
})
console.log('Shuten calibration:', JSON.stringify({
  average: Number(calibrationResult.averageFloor.toFixed(1)),
  median: calibrationResult.medianFloor,
  low: calibrationResult.minFloor,
  high: calibrationResult.maxFloor,
}))
