import cards from '../src/data/cards'
import { simulateBattleV2 } from '../src/engine/battle-v2'
import type { DepthsEnemy, TeamLoadout } from '../src/types'

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message) }
const anubis = cards.find((card) => card.name === 'Anubis')
const archer = cards.find((card) => card.name === 'Archer')
assert(anubis && archer, 'Regression cards missing')
const enemyPower = 100
const enemies: DepthsEnemy[] = [
  { card: anubis, power: enemyPower, attack: 50, health: 100 },
  { card: archer, power: enemyPower, attack: 50, health: 100 },
]
const loadout: TeamLoadout = { cards: ['Behemoth','Behemoth','Behemoth','Behemoth'].map((cardName) => ({ cardName, borders: ['Galaxy'] })) }
const battle = simulateBattleV2(loadout, enemies, 12345, 500, true, true)
const revives = battle.debug?.events.filter((event) => event.type === 'revive' && event.card === 'Anubis') || []
assert(revives.length === 1, `Expected exactly one Anubis revive, got ${revives.length}`)
const revive = revives[0]
assert(revive.maxHp === 100, `Expected base MaxHP 100 after revive, got ${revive.maxHp}`)
assert(revive.hp === 50, `Expected half HP 50 after revive, got ${revive.hp}`)
assert(revive.damage === 50, `Expected base ATK 50 after revive, got ${revive.damage}`)
console.log('Anubis regression passed: self-revives exactly once at half base HP.')
