import cards from '../src/data/cards'
import abilities from '../src/data/abilities'
import auras from '../src/data/auras'
import { buildSkillAuraBoosts } from '../src/engine/auras'
import { simulateBattleV2 } from '../src/engine/battle-v2'
import type { CardDefinition, DepthsEnemy, TeamLoadout } from '../src/types'

const dummy: CardDefinition = {
  name: '__Player Coverage Dummy__',
  imageAssetId: null,
  rarity: 1,
  statMultiplier: 1,
  hpMultiplier: 1,
  ability: null,
  weather: null,
  pack: null,
  boss: false,
  unobtainable: false,
  expires: false,
}

const enemy: DepthsEnemy = { card: dummy, power: 1, attack: 1, health: 1 }
const representatives = new Map<string, (typeof cards)[number]>()

for (const card of cards) {
  if (card.unobtainable || !card.ability || representatives.has(card.ability)) continue
  representatives.set(card.ability, card)
}

const unsupportedCards = new Map<string, string[]>()
let index = 0
for (const [ability, card] of representatives) {
  const loadout: TeamLoadout = { cards: [{ cardName: card.name, borders: [] }] }
  const battle = simulateBattleV2(loadout, [enemy], 700_000 + index++)
  if (battle.unsupportedAbilities.length) unsupportedCards.set(ability, battle.unsupportedAbilities)
}

const selectableSkillAuras = auras.filter((aura) => !aura.unobtainable && aura.type === 'Skill')
const unsupportedAuras = selectableSkillAuras
  .filter((aura) => !buildSkillAuraBoosts({ auraName: aura.name }).implemented)
  .map((aura) => `${aura.name} (${aura.skillName}): ${aura.description}`)

console.log(`Selectable player ability types: ${representatives.size}`)
console.log(`Unsupported selectable player abilities (${unsupportedCards.size}):`)
for (const [ability, runtime] of unsupportedCards) {
  const card = representatives.get(ability)
  console.log(`- ${ability} | card=${card?.name ?? 'unknown'} | ${abilities[ability] ?? 'No description'} | runtime=${runtime.join(', ')}`)
}
console.log(`Selectable skill auras: ${selectableSkillAuras.length}`)
console.log(`Unsupported selectable skill auras (${unsupportedAuras.length}):`)
for (const aura of unsupportedAuras) console.log(`- ${aura}`)
