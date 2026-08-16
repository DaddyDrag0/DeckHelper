import assert from 'node:assert/strict'
import cards from '../src/data/cards'
import type { InventoryState } from '../src/app-types'
import { searchBestTeams } from '../src/optimizer/search'

const sample = cards.filter((card) => !card.unobtainable && !card.expires).slice(0, 5)
assert.equal(sample.length, 5, 'Expected at least five usable cards in the data set')

const inventory: InventoryState = {
  cards: sample.map((card, index) => ({
    cardName: card.name,
    borders: [],
    locked: index === 0,
    lockedPosition: index === 0 ? 2 : null,
  })),
  statAuras: [],
  abilityAuras: [],
}

const results = searchBestTeams(inventory, {
  candidateCap: 12,
  quickCandidateCap: 12,
  middleCandidateCap: 4,
  finalistCap: 3,
  finalSeedCount: 3,
  maxFloor: 40,
}, () => {})

assert.ok(results.length > 0, 'Optimizer should return at least one team')
for (const result of results) {
  assert.equal(result.loadout.cards.length, 4, 'Every result must contain four cards')
  assert.equal(result.loadout.cards[2]?.cardName, sample[0].name, 'Position lock must be preserved')
  assert.ok(result.metrics.samples >= 3, 'Final metrics should use the requested seed sample count')
}

console.log(`Optimizer smoke passed with ${results.length} ranked teams.`)
