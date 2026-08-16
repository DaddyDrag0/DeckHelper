import assert from 'node:assert/strict'
import { exportInventoryCode, importInventoryCode } from '../src/storage'
import type { InventoryState } from '../src/app-types'

const inventory: InventoryState = {
  cards: [
    { cardName: "Heaven's Armor", quantity: 2, borders: ['Platinum', 'Crystal'], locked: true, lockedPosition: 1 },
    { cardName: "Heaven's Armor", quantity: 1, borders: ['Galaxy'], locked: false, lockedPosition: null },
    { cardName: 'ToadBoiGaming', quantity: 4, borders: [], locked: false, lockedPosition: null },
  ],
  statAuras: [{ auraName: 'Totality', borders: ['Galaxy'], locked: true }],
  abilityAuras: [{ auraName: 'Celestial', borders: ['Crystal'], locked: false }],
}

const code = exportInventoryCode(inventory)
assert.ok(code.startsWith('DHINV1:'), 'Inventory code prefix/version is missing')
const restored = importInventoryCode(code)
assert.deepEqual(restored, inventory, 'Inventory code did not preserve exact variants, quantities, locks, positions, or auras')
const stackedAuraInventory: InventoryState = { ...inventory, statAuras: [{ auraName: 'Totality', borders: ['Base', 'Platinum', 'Galaxy'], locked: false }] }
const sanitized = importInventoryCode(exportInventoryCode(stackedAuraInventory))
assert.deepEqual(sanitized.statAuras[0]?.borders, ['Galaxy'], 'Legacy stacked aura borders must collapse to one legal aura border')
assert.throws(() => importInventoryCode('not-a-code'), /not a DeckHelper inventory code/i)
assert.throws(() => importInventoryCode('DHINV1:broken'), /damaged or incomplete/i)
console.log(`inventory code regression passed (${code.length} characters)`)
