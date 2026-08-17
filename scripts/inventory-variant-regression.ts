import assert from 'node:assert/strict'
import cards from '../src/data/cards'
import type { InventoryState } from '../src/app-types'
import { borderKey } from '../src/card-variants'
import { searchBestTeams } from '../src/optimizer/search'

const usable = cards.filter((card) => !card.unobtainable && !card.expires).slice(0, 3)
assert.equal(usable.length, 3, 'Expected three usable cards')

const inventory: InventoryState = {
  cards: [
    { cardName: usable[0].name, quantity: 1, borders: ['Platinum', 'Crystal'], locked: true, lockedPosition: 0 },
    { cardName: usable[0].name, quantity: 1, borders: ['Galaxy'], locked: true, lockedPosition: 1 },
    { cardName: usable[1].name, quantity: 1, borders: [], locked: true, lockedPosition: 2 },
    { cardName: usable[2].name, quantity: 1, borders: [], locked: true, lockedPosition: 3 },
  ],
  statAuras: [],
  abilityAuras: [],
}

const results = await searchBestTeams(inventory, {
  candidateCap: 8,
  quickCandidateCap: 8,
  middleCandidateCap: 4,
  finalistCap: 3,
  finalSeedCount: 3,
  maxFloor: 40,
}, () => {})

assert.ok(results.length, 'Expected a result for the fully locked deck')
const team = results[0].loadout.cards
assert.equal(team[0].cardName, usable[0].name)
assert.equal(borderKey(team[0].borders), 'Platinum+Crystal')
assert.equal(team[1].cardName, usable[0].name)
assert.equal(borderKey(team[1].borders), 'Galaxy')
assert.equal(team[2].cardName, usable[1].name)
assert.equal(team[3].cardName, usable[2].name)

console.log('Optimizer preserved two exact variants of the same card name in one team.')
