import cards from '../src/data/cards'
import { generateDepthsTeam } from '../src/engine/depths'
import { simulateBattleV2 } from '../src/engine/battle-v2'
import type { DepthsEnemy, TeamLoadout } from '../src/types'

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message) }

const zombie = cards.find((card) => card.name === 'Zombie Dragon')
const wendigo = cards.find((card) => card.name === 'Wendigo')
assert(zombie && wendigo, 'Zombie Dragon/Wendigo cards missing')

const syntheticEnemy: DepthsEnemy[] = [{ card: wendigo, power: 1e12, health: 1e12, attack: 1e9 }]
const synthetic = simulateBattleV2(
  { cards: [{ cardName: 'Zombie Dragon', borders: ['Platinum', 'Crystal'] }, { cardName: 'Hades', borders: ['Crystal', 'Galaxy'] }] },
  syntheticEnemy, 987654321, 100, true, true,
)
assert(synthetic.turns <= 100, 'Wendigo/Unholy regression exceeded battle turn cap')
assert(!synthetic.debug?.events.some((e) => e.detail.includes('Insatiable same-turn chain stopped')), 'Synthetic regression still hit Insatiable safety limit')

function mixSeed(runSeed: number, floor: number): number {
  let x = (runSeed ^ Math.imul(floor, 0x9e3779b1)) >>> 0
  x ^= x >>> 16; x = Math.imul(x, 0x85ebca6b) >>> 0
  x ^= x >>> 13; x = Math.imul(x, 0xc2b2ae35) >>> 0
  return (x ^ (x >>> 16)) >>> 0
}
const floor = 1625
const runSeed = 1241481851
const floorSeed = mixSeed(runSeed, floor)
const enemies = generateDepthsTeam(floor, floorSeed)
const names = enemies.map((enemy) => enemy.card.name)
assert(names.join('|') === 'Demon Hunter|Yamato no Orochi|Stegosaurus|Mummy', 'Reported enemy lineup changed: ' + names.join(' | '))
const loadout: TeamLoadout = { cards: [
  { cardName: 'Zombie Dragon', borders: ['Platinum', 'Crystal'] },
  { cardName: 'Hades', borders: ['Crystal', 'Galaxy'] },
  { cardName: 'Fuxi', borders: [] },
  { cardName: "Terra's Aria", borders: ['Platinum', 'Galaxy'] },
] }
const exact = simulateBattleV2(loadout, enemies, floorSeed ^ 0x51ed270b, 10_000, true, true)
assert(exact.turns <= 10_000, 'Reported floor did not terminate')
assert(!exact.debug?.events.some((e) => e.detail.includes('Insatiable same-turn chain stopped')), 'Reported floor required Insatiable safety limit')
console.log('Insatiable/Unholy regression passed:', { syntheticTurns: synthetic.turns, exactTurns: exact.turns, winner: exact.winner, names })
