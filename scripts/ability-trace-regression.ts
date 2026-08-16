import { strict as assert } from 'node:assert'
import cards from '../src/data/cards'
import { simulateBattleV2 } from '../src/engine/battle-v2'
import type { DepthsEnemy, TeamLoadout } from '../src/types'

function card(name: string) {
  const found = cards.find((entry) => entry.name === name)
  assert(found, `Missing card definition: ${name}`)
  return found
}

function enemy(name: string, health: number, attack: number, power = health): DepthsEnemy {
  return { card: card(name), health, attack, power }
}

function hasAbilityLog(result: ReturnType<typeof simulateBattleV2>, cardName: string, text: string) {
  return Boolean(result.debug?.events.some((event) =>
    event.type === 'ability' && event.card === cardName && event.detail.includes(text),
  ))
}

// Pangu used to visibly double between turns without any explanation in the log.
const panguLoadout: TeamLoadout = { cards: [{ cardName: 'Pangu', borders: [] }] }
const panguBattle = simulateBattleV2(
  panguLoadout,
  [enemy('Shining Armor', 1_000_000_000_000_000, 1)],
  41,
  8,
  false,
  true,
)
assert(
  hasAbilityLog(panguBattle, 'Pangu', 'World Creation'),
  'World Creation must emit an ability interaction when Pangu doubles on its third turn.',
)

// Odin's All Father dodge is handled outside the normal defensive ability switch, so it
// previously changed HP while silently zeroing the incoming hit.
const odinLoadout: TeamLoadout = { cards: [{ cardName: 'Shining Armor', borders: [] }] }
const odinBattle = simulateBattleV2(
  odinLoadout,
  [enemy('Odin', 1_000, 1, 1_000)],
  73,
  3,
  false,
  true,
)
assert(
  hasAbilityLog(odinBattle, 'Odin', 'All Father dodged'),
  'All Father must emit an ability interaction when Odin dodges a normal attack and pays HP.',
)

console.log('Ability trace regressions passed: Pangu World Creation + Odin All Father.')
