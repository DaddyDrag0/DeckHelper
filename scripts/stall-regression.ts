import { simulateBattleV2 } from '../src/engine/battle-v2'
import { generateDepthsTeam } from '../src/engine/depths'
import cards from '../src/data/cards'
import type { DepthsEnemy, TeamLoadout } from '../src/types'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function mixSeed(runSeed: number, floor: number): number {
  let x = (runSeed ^ Math.imul(floor, 0x9e3779b1)) >>> 0
  x ^= x >>> 16
  x = Math.imul(x, 0x85ebca6b) >>> 0
  x ^= x >>> 13
  x = Math.imul(x, 0xc2b2ae35) >>> 0
  return (x ^ (x >>> 16)) >>> 0
}

// Regression for a real browser stall: duplicate Anubis cards can revive each
// other forever through Beyond The Grave unless the resurrection chain resolves.
const runSeed = 983450096
const floor = 97
const floorSeed = mixSeed(runSeed, floor)
const enemies = generateDepthsTeam(floor, floorSeed)
const enemyNames = enemies.map((enemy) => enemy.card.name)

assert(
  JSON.stringify(enemyNames) === JSON.stringify(['Anubis', 'Darling', 'Anubis', 'ToadBoiGaming']),
  `Stall regression floor changed: ${enemyNames.join(' | ')}`,
)

const loadout: TeamLoadout = {
  cards: ['Behemoth', 'Tyrannodon', 'Surtr', 'Kraken'].map((cardName) => ({
    cardName,
    borders: ['Galaxy'],
  })),
}

const battle = simulateBattleV2(loadout, enemies, floorSeed ^ 0x51ed270b, 5_000, true)
assert(battle.winner === 'Allies', `Duplicate-Anubis regression winner was ${battle.winner}`)
assert(!battle.unsupportedAbilities.includes('Battle turn cap reached'), 'Duplicate-Anubis regression hit emergency turn cap')
assert(battle.turns < 1_000, `Duplicate-Anubis regression still took too long: ${battle.turns} turns`)
console.log(`Duplicate-Anubis stall regression passed: ${battle.turns} turns.`)

// Regression for the 2026-08-14 high-floor browser loop. Eternal Voyage can
// continuously rotate active cards without anyone dying. Position changes are
// not deaths and therefore must NOT reset Expansion's 150-turn no-death timer.
const voyageCard = cards.find((card) => card.ability === 'Eternal Voyage')
const inertBase = cards.find((card) => card.name === 'Mastermind') || cards[0]
assert(voyageCard, 'Eternal Voyage regression card missing')
assert(inertBase, 'Rotating-stall target card missing')

const rotatingLoadout: TeamLoadout = {
  cards: [
    { cardName: voyageCard.name, borders: [] },
    { cardName: voyageCard.name, borders: [] },
  ],
}
const inertEnemy: DepthsEnemy = {
  card: { ...inertBase, name: '__Rotating Stall Target__', ability: null },
  power: 1,
  attack: 0,
  health: 1e30,
}
const rotatingBattle = simulateBattleV2(rotatingLoadout, [inertEnemy], 424242, 5_000, true)
assert(!rotatingBattle.unsupportedAbilities.includes('Battle turn cap reached'), 'Rotating-card regression hit emergency turn cap')
assert(rotatingBattle.turns >= 145 && rotatingBattle.turns <= 155, `Rotating-card no-death timeout should resolve at ~150 turns, got ${rotatingBattle.turns}`)
console.log(`Rotating-card stall regression passed: ${rotatingBattle.turns} turns.`)
