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
