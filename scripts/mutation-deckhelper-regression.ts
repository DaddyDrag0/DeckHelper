import assert from 'node:assert/strict'
import cards from '../src/data/cards'
import { cardVariantKey, cardVariantLabel, teamCardVariantKey } from '../src/card-variants'
import { exportInventoryCode, importInventoryCode } from '../src/storage'
import { mutationEligibleCard, normalizeMutationWeather } from '../src/mutations'
import type { InventoryState } from '../src/app-types'

const archer = cards.find((card) => card.name === 'Archer')
const pandora = cards.find((card) => card.name === 'Pandora')
assert.ok(archer)
assert.ok(pandora)

assert.equal(mutationEligibleCard(archer), true)
assert.equal(mutationEligibleCard(pandora), false)
assert.equal(normalizeMutationWeather('Manga', archer), 'Manga')
assert.equal(normalizeMutationWeather('Manga', pandora), null)

// Lock every Weather Mutation multiplier and eligibility rule used by the Deck Helper UI/optimizer.
const expectedMultipliers = {
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
} as const
const { WEATHER_MUTATION_STAT_MULTIPLIERS, getAttack, getHealth } = await import('../src/engine/stats')
assert.deepEqual(WEATHER_MUTATION_STAT_MULTIPLIERS, expectedMultipliers)
for (const [weather, multiplier] of Object.entries(expectedMultipliers)) {
  const typedWeather = weather as keyof typeof expectedMultipliers
  assert.equal(getAttack(archer, [], typedWeather), getAttack(archer) * multiplier)
  assert.equal(getHealth(archer, ['Platinum'], typedWeather), getHealth(archer, ['Platinum']) * multiplier)
}

const weatherCard = cards.find((card) => Boolean(card.weather))
const bossCard = cards.find((card) => card.boss)
const unobtainableCard = cards.find((card) => card.unobtainable && !card.weather && !card.boss)
const expiringCard = cards.find((card) => card.expires && !card.weather && !card.boss)
assert.ok(weatherCard)
assert.ok(bossCard)
assert.equal(mutationEligibleCard(weatherCard), false)
assert.equal(mutationEligibleCard(bossCard), false)
if (unobtainableCard) assert.equal(mutationEligibleCard(unobtainableCard), false)
if (expiringCard) assert.equal(mutationEligibleCard(expiringCard), false)

// Eclipse's normal weather-card stat nerf is separate from the Eclipse Mutation multiplier.
const eclipseCards = cards.filter((card) => card.weather === 'Eclipse')
assert.ok(eclipseCards.length > 0)
assert.ok(eclipseCards.every((card) => card.statMultiplier === 5))

const baseKey = cardVariantKey('Archer', ['Platinum'])
const stormKey = cardVariantKey('Archer', ['Platinum'], 'Storm')
const mangaKey = cardVariantKey('Archer', ['Platinum'], 'Manga')
assert.notEqual(baseKey, stormKey)
assert.notEqual(stormKey, mangaKey)
assert.equal(
  teamCardVariantKey({ cardName: 'Archer', borders: ['Platinum'], mutationWeather: 'Storm' }),
  stormKey,
)
assert.match(cardVariantLabel(['Platinum'], 'Manga'), /Manga Mutation/)

const inventory: InventoryState = {
  cards: [
    { cardName: 'Archer', quantity: 1, borders: ['Platinum'], mutationWeather: null, locked: false, lockedPosition: null },
    { cardName: 'Archer', quantity: 1, borders: ['Platinum'], mutationWeather: 'Storm', locked: true, lockedPosition: 0 },
    { cardName: 'Archer', quantity: 1, borders: ['Platinum'], mutationWeather: 'Manga', locked: true, lockedPosition: 1 },
  ],
  statAuras: [],
  abilityAuras: [],
}
const code = exportInventoryCode(inventory)
assert.match(code, /^DHINV2:/)
assert.deepEqual(importInventoryCode(code), inventory)

// Old DHINV1 backups must remain readable and become non-mutated variants.
const legacyPayload = {
  version: 1,
  inventory: {
    cards: [{ cardName: 'Archer', quantity: 2, borders: ['Crystal'], locked: false, lockedPosition: null }],
    statAuras: [],
    abilityAuras: [],
  },
}
const legacy = 'DHINV1:' + Buffer.from(JSON.stringify(legacyPayload), 'utf8').toString('base64url')
const restoredLegacy = importInventoryCode(legacy)
assert.equal(restoredLegacy.cards[0]?.mutationWeather, null)
assert.equal(restoredLegacy.cards[0]?.quantity, 2)

console.log('DeckHelper mutation variant regression passed.')
