import { simulateBattleV2 } from '../src/engine/battle-v2'
import cards from '../src/data/cards'
import type { DepthsEnemy, TeamLoadout } from '../src/types'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const mastermind = cards.find((card) => card.name === 'Mastermind')
if (!mastermind) throw new Error('Mastermind test card missing')

const enemyCard = { ...mastermind, name: '__Watchdog Heartbeat Enemy__', ability: null }
const enemies: DepthsEnemy[] = [{ card: enemyCard, power: 1, attack: 0, health: 1e30 }]
const loadout: TeamLoadout = { cards: [{ cardName: 'Mastermind', borders: [] }] }
const beats: number[] = []
const battle = simulateBattleV2(loadout, enemies, 424242, 10_000, true, false, (turn) => beats.push(turn))

assert(!battle.unsupportedAbilities.includes('Battle turn cap reached'), 'Heartbeat test hit emergency battle cap')
assert(battle.turns >= 145 && battle.turns <= 155, 'Expected Expansion 150-turn no-progress resolution, got ' + battle.turns)
assert(beats.length >= 20, 'Too few watchdog heartbeats: ' + beats.length)
assert(beats[0] === 5, 'First heartbeat should be turn 5, got ' + beats[0])
assert(beats.some((turn) => turn >= 145), 'Heartbeat did not continue through the long battle')
for (let index = 1; index < beats.length; index++) {
  assert(beats[index] > beats[index - 1], 'Heartbeat turns did not increase monotonically')
}

console.log('Watchdog heartbeat regression passed:', battle.turns, 'turns with', beats.length, 'heartbeats.')
