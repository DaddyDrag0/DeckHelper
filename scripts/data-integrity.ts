import { strict as assert } from 'node:assert'
import cards1 from '../src/data/cards-1.json'
import cards2 from '../src/data/cards-2.json'
import cards3 from '../src/data/cards-3.json'
import cards4 from '../src/data/cards-4.json'
import cards5 from '../src/data/cards-5.json'
import cards6 from '../src/data/cards-6.json'
import cards7 from '../src/data/cards-7.json'
import auras1 from '../src/data/auras-1.json'
import auras2 from '../src/data/auras-2.json'
import abilities1 from '../src/data/abilities-1.json'
import abilities2 from '../src/data/abilities-2.json'
import abilities3 from '../src/data/abilities-3.json'
import abilities4 from '../src/data/abilities-4.json'

const cardBatches = [cards1, cards2, cards3, cards4, cards5, cards6, cards7]
const auraBatches = [auras1, auras2]
const abilityBatches = [abilities1, abilities2, abilities3, abilities4]

function assertUniqueNames(items: Array<{ name: string }>, label: string) {
  const exact = new Set<string>()
  const folded = new Map<string, string>()
  for (const item of items) {
    assert(item.name && item.name.trim(), `${label} has an empty name`)
    assert(!exact.has(item.name), `Duplicate ${label} name: ${item.name}`)
    const key = item.name.toLocaleLowerCase('en-US')
    assert(!folded.has(key), `Case-insensitive duplicate ${label}: ${item.name} / ${folded.get(key)}`)
    exact.add(item.name)
    folded.set(key, item.name)
  }
}

const cards = cardBatches.flat()
assertUniqueNames(cards, 'card')
assert.equal(cards.filter((card) => card.name === 'Conqueror').length, 1, 'Conqueror must exist exactly once')
const admiralIce = cards.find((card) => card.name === 'Admiral Ice')
assert(admiralIce, 'Admiral Ice must exist')
assert.equal(admiralIce.rarity, 750000, 'Admiral Ice rarity changed unexpectedly')
assert.equal(admiralIce.statMultiplier, 1.5, 'Admiral Ice stat multiplier must match game source')
const wendigo = cards.find((card) => card.name === 'Wendigo')
assert(wendigo, 'Wendigo must exist')
assert.equal(wendigo.rarity, 25_000_000, 'Wendigo rarity must match current game source')
assert.equal(wendigo.statMultiplier, 1.7, 'Wendigo StatMultiplier must match current game source')
for (const card of cards) {
  assert(Number.isFinite(card.rarity) && card.rarity >= 0, `${card.name} has invalid rarity`)
  assert(Number.isFinite(card.statMultiplier) && card.statMultiplier > 0, `${card.name} has invalid statMultiplier`)
  assert(Number.isFinite(card.hpMultiplier) && card.hpMultiplier > 0, `${card.name} has invalid hpMultiplier`)
}

const auras = auraBatches.flat()
assertUniqueNames(auras, 'aura')

const abilityNames = new Set<string>()
const abilityFolded = new Map<string, string>()
for (const batch of abilityBatches) {
  for (const name of Object.keys(batch)) {
    assert(!abilityNames.has(name), `Duplicate ability description key: ${name}`)
    const key = name.toLocaleLowerCase('en-US')
    assert(!abilityFolded.has(key), `Case-insensitive duplicate ability: ${name} / ${abilityFolded.get(key)}`)
    abilityNames.add(name)
    abilityFolded.set(key, name)
  }
}

const missingDescriptions = [...new Set(cards.filter((card) => !card.unobtainable).map((card) => card.ability).filter((name): name is string => Boolean(name) && !abilityNames.has(name)))]
assert.deepEqual(missingDescriptions, [], `Cards reference abilities with no description: ${missingDescriptions.join(', ')}`)

console.log(`Data integrity passed: ${cards.length} unique cards, ${auras.length} unique auras, ${abilityNames.size} unique ability descriptions.`)
