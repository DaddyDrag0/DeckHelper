import { strict as assert } from 'node:assert'
import cards from '../src/data/cards'
import auras from '../src/data/auras'
import { applySkillAuraTeamEffects, statAuraPercentForCard } from '../src/engine/auras'
import { simulateBattleV2 } from '../src/engine/battle-v2'
import { getAttack, getHealth, WEATHER_MUTATION_STAT_MULTIPLIERS } from '../src/engine/stats'
import type { CombatCard, DepthsEnemy, MutationWeather } from '../src/types'

const card = (name: string) => {
  const found = cards.find((entry) => entry.name === name)
  assert(found, name)
  return found
}
const neutralTarget = card('Trainee')
const foe = (hp = 1e30, attack = 0): DepthsEnemy => ({ card: neutralTarget, power: hp, health: hp, attack })
const close = (a: number, b: number) => assert(Math.abs(a - b) <= Math.max(1.1, Math.abs(b) * 1e-9), `${a} != ${b}`)

const expected: Record<MutationWeather, number> = {
  Storm: 1.1,
  Snow: 1.2,
  Aurora: 1.3,
  Shroud: 1.5,
  'Meteor Shower': 1.8,
  'Time Storm': 2,
  Eclipse: 2.5,
  Virus: 3,
  'Blood Rain': 3.5,
  Armageddon: 4,
  Manga: 4.5,
}
assert.deepEqual(WEATHER_MUTATION_STAT_MULTIPLIERS, expected)

const eclipseCards = cards.filter((entry) => entry.weather === 'Eclipse')
assert(eclipseCards.length > 0)
assert(eclipseCards.every((entry) => entry.statMultiplier === 5), 'all Eclipse weather cards should use the nerfed 5x stat multiplier')

const base = card('Shining Armor')
for (const [weather, multiplier] of Object.entries(expected) as [MutationWeather, number][]) {
  close(getAttack(base, [], weather), getAttack(base) * multiplier)
  close(getHealth(base, ['Platinum'], weather), getHealth(base, ['Platinum']) * multiplier)
}

const oneRing = auras.find((aura) => aura.name === 'The One Ring')
assert(oneRing)
const stormcaller = auras.find((aura) => aura.name === 'Stormcaller')
assert(stormcaller)
const mock = {
  definition: base,
  mutationWeather: 'Storm',
} as CombatCard
assert.equal(statAuraPercentForCard(oneRing, mock, null), 0)
assert(statAuraPercentForCard(stormcaller, mock, null) > statAuraPercentForCard(stormcaller, { ...mock, mutationWeather: null } as CombatCard, null))

const prehistoric = cards.filter((entry) => entry.pack === 'Prehistoric').slice(0, 4)
assert.equal(prehistoric.length, 4)
const prehistoricTeam = prehistoric.map((definition, index) => {
  const hp = getHealth(definition)
  return {
    id: `Allies:${index}:${definition.name}`,
    definition,
    team: 'Allies',
    index,
    borders: [],
    power: hp,
    hp,
    maxHp: hp,
    damage: getAttack(definition),
    entered: false,
    dead: false,
    boss: Boolean(definition.boss),
    status: { stunned: 0, confused: 0, burn: 0, weakness: false, blind: false, shield: 0 },
    flags: {},
    counters: {},
  } as CombatCard
})
const jw = auras.find((aura) => aura.name === 'Jurassic World')
assert(jw)
const beforeJw = prehistoricTeam[0].damage
applySkillAuraTeamEffects(prehistoricTeam, { auraName: 'Jurassic World', border: 'Galaxy' })
close(prehistoricTeam[0].damage, beforeJw * 1.8)

const spotlightDef = cards.find((entry) => entry.ability === 'Stolen Spotlight')
assert(spotlightDef)
const behind = card('Shining Armor')
const spotlightBattle = simulateBattleV2({
  cards: [
    { cardName: spotlightDef.name, borders: [] },
    { cardName: behind.name, borders: [] },
  ],
}, [foe()], 123, 1, false, true)
const spotlight = [...spotlightBattle.state.teams.Allies, ...spotlightBattle.state.fallen.Allies].find((entry) => entry.definition.name === spotlightDef.name)
assert(spotlight)
close(spotlight.damage, getAttack(spotlightDef) + getAttack(behind) * 0.75)
close(spotlight.maxHp, getHealth(spotlightDef) + getHealth(behind) * 0.75)

const sacredDef = cards.find((entry) => entry.ability === 'Sacred Judgment')
assert(sacredDef)
const sacredEnemy = foe(1e9)
const sacredBattle = simulateBattleV2({ cards: [{ cardName: sacredDef.name, borders: [] }] }, [sacredEnemy], 1, 1)
const sacredRemaining = sacredBattle.state.teams.Enemies[0]
assert(sacredRemaining)
close(sacredEnemy.health - sacredRemaining.hp, getAttack(sacredDef) * 1.25)

const ice = card('Ice King')
const frozenEnemy = foe(1e9)
const frozenBattle = simulateBattleV2({ cards: [{ cardName: ice.name, borders: [] }] }, [frozenEnemy], 1, 2, false, true)
const frozenRemaining = frozenBattle.state.teams.Enemies[0]
assert(frozenRemaining)
close(frozenEnemy.health - frozenRemaining.hp, getAttack(ice) * 3)
assert.equal(Boolean(frozenRemaining.flags.frozenSolitudeFirstTurnUsed), true)

console.log('Mutation update regression passed.')
