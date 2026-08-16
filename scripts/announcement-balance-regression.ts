import { strict as assert } from 'node:assert'
import cards from '../src/data/cards'
import { simulateBattleV2 } from '../src/engine/battle-v2'
import { getAttack, getHealth } from '../src/engine/stats'
import type { DepthsEnemy, TeamLoadout } from '../src/types'

function card(name: string) {
  const found = cards.find((entry) => entry.name === name)
  assert(found, `Missing card definition: ${name}`)
  return found
}

function enemy(name: string, health: number, attack: number, power = health): DepthsEnemy {
  return { card: card(name), health, attack, power }
}

function combatCard(result: ReturnType<typeof simulateBattleV2>, team: 'Allies' | 'Enemies', name: string) {
  return [...result.state.teams[team], ...result.state.fallen[team]].find((entry) => entry.definition.name === name)
}

function close(actual: number, expected: number, label: string) {
  const tolerance = Math.max(1e-6, Math.abs(expected) * 1e-9)
  assert(Math.abs(actual - expected) <= tolerance, `${label}: expected ${expected}, got ${actual}`)
}

const typhonDef = card('Typhon')
const typhonBattle = simulateBattleV2(
  { cards: [{ cardName: 'Typhon', borders: [] }] },
  [enemy('Shining Armor', 1e30, 1e30)],
  1101, 1, false, true,
)
const typhon = combatCard(typhonBattle, 'Allies', 'Typhon')
assert(typhon, 'Typhon must exist after the regression battle.')
close(typhon.maxHp, getHealth(typhonDef) * 3, 'Typhon Immortal max HP')

const hunterDef = card('Hunter')
const hunterBattle = simulateBattleV2(
  { cards: [{ cardName: 'Hunter', borders: [] }] },
  [enemy('Shining Armor', 1e30, 1e30)],
  1102, 1, false, true,
)
const hunter = combatCard(hunterBattle, 'Allies', 'Hunter')
assert(hunter, 'Hunter must exist after the regression battle.')
close(hunter.maxHp, getHealth(hunterDef), 'Hunter Patience max HP')
close(hunter.damage, getAttack(hunterDef) * 1.3, 'Hunter Patience ATK')

// Use three turns so the ordinary ally first takes damage on the enemy turn and then
// attacks again, giving Vampire Matron a real missing-HP amount to restore.
const normalVampBattle = simulateBattleV2(
  {
    cards: [{ cardName: 'Shining Armor', borders: [] }],
    abilityAura: { auraName: 'Vampire Matron', border: null },
  },
  [enemy('Arthur', 1e20, getHealth(card('Shining Armor')) * 0.2)],
  1103, 3, false, true,
)
assert(
  normalVampBattle.debug?.events.some((event) => event.detail.includes('Vampire Matron aura healed')),
  'Vampire Matron should still heal ordinary allies.',
)

for (const excluded of ['Odin', 'Gilgamesh']) {
  const result = simulateBattleV2(
    {
      cards: [{ cardName: excluded, borders: [] }],
      abilityAura: { auraName: 'Vampire Matron', border: null },
    },
    [enemy('Arthur', 1e20, getHealth(card(excluded)) * 0.2)],
    excluded === 'Odin' ? 1104 : 1105, 3, false, true,
  )
  assert(
    !result.debug?.events.some((event) => event.card === excluded && event.detail.includes('Vampire Matron aura healed')),
    `Vampire Matron must not heal ${excluded}.`,
  )
}

const veilLoadout: TeamLoadout = {
  cards: [
    { cardName: 'Shining Armor', borders: [] },
    { cardName: 'Eclipseborn Luminant', borders: [] },
  ],
}
let ordinaryEvadeSeen = false
for (let seed = 1200; seed < 1230; seed++) {
  const result = simulateBattleV2(veilLoadout, [enemy('Arthur', 1e20, 100)], seed, 4, false, true)
  if (result.debug?.events.some((event) => event.detail.includes('Luminescent Veil evaded an attack'))) {
    ordinaryEvadeSeen = true
    break
  }
}
assert(ordinaryEvadeSeen, 'Luminescent Veil should still evade ordinary attackers.')

for (const excluded of ['Kira', 'Judgment Day']) {
  for (let seed = 1300; seed < 1320; seed++) {
    const result = simulateBattleV2(veilLoadout, [enemy(excluded, 1e20, 100)], seed, 4, false, true)
    assert(
      !result.debug?.events.some((event) => event.detail.includes('Luminescent Veil evaded an attack')),
      `Luminescent Veil must not evade ${excluded}.`,
    )
  }
}

const deadlyAmbushBattle = simulateBattleV2(
  { cards: [{ cardName: 'Dilophosaurus', borders: [] }] },
  [enemy('Shining Armor', 1, 1), enemy('Arthur', 1e20, 1e20)],
  1400, 2, false, true,
)
const secondEnemy = combatCard(deadlyAmbushBattle, 'Enemies', 'Arthur')
assert(secondEnemy, 'Second Deadly Ambush regression enemy must exist.')
assert.equal(secondEnemy.counters.poisonPercent || 0, 0, 'Deadly Ambush poison must not jump to the next enemy.')

console.log('Announcement balance regressions passed: Typhon, Hunter, Vampire Matron, Luminescent Veil, Deadly Ambush.')
