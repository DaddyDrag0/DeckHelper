import assert from 'node:assert/strict'
import { encodeDepthsTeam } from '../src/depths-export'
import type { TeamLoadout } from '../src/types'

const loadout: TeamLoadout = {
  cards: [
    { cardName: 'Lilith The Enchantress', borders: ['Platinum', 'Crystal'] },
    { cardName: 'The Jade Emperor', borders: ['Platinum', 'Crystal'] },
    { cardName: "Heaven's Armor", borders: ['Platinum', 'Ruby'] },
    { cardName: "Terra's Aria", borders: ['Platinum', 'Crystal'] },
  ],
  statAura: { auraName: 'Elohim', border: 'Crystal' },
  abilityAura: { auraName: 'Berserker', border: 'Galaxy' },
}

const code = encodeDepthsTeam(loadout)
assert.ok(code.startsWith('CRE1-'), 'Depths export must use the calculator CRE1 format')
let raw = code.slice(5).replace(/-/g, '+').replace(/_/g, '/')
while (raw.length % 4) raw += '='
const payload = JSON.parse(Buffer.from(raw, 'base64').toString('utf8'))
assert.equal(payload.v, 1)
assert.deepEqual(payload.c, loadout.cards.map((card) => [card.cardName, card.borders]))
assert.deepEqual(payload.s, ['Elohim', 'Crystal'])
assert.deepEqual(payload.a, ['Berserker', 'Galaxy'])
console.log('Depths export CRE1 regression passed')
