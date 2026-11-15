import assert from 'node:assert/strict'
import cards from '../src/data/cards'
import { BORDER_RARITY_MULTIPLIERS, rarityWithBorders } from '../src/engine/stats'
import { ALL_CARD_BORDER_VARIANTS, CARD_BORDER_ORDER, borderVariantLabel, canonicalBorders, isPerfectGem } from '../src/card-variants'
import { exportInventoryCode, importInventoryCode } from '../src/storage'

assert.deepEqual(CARD_BORDER_ORDER,['Platinum','Emerald','Crystal','Ruby','Galaxy'])
assert.equal(BORDER_RARITY_MULTIPLIERS.Emerald,1000)
assert.equal(ALL_CARD_BORDER_VARIANTS.length,32)
const five=[...CARD_BORDER_ORDER]
const four=five.filter(border=>border!=='Emerald')
assert.equal(isPerfectGem(five),true)
assert.equal(isPerfectGem(four),false)
assert.match(borderVariantLabel(five),/Perfect Gem/)
assert.doesNotMatch(borderVariantLabel(four),/Perfect Gem/)
assert.deepEqual(canonicalBorders(['Galaxy','Emerald','Platinum']),['Platinum','Emerald','Galaxy'])
const card=cards.find(c=>c.name==='Archer')!
assert.equal(rarityWithBorders(card,['Emerald']),card.rarity*1000)
const fullMultiplier=Object.values(BORDER_RARITY_MULTIPLIERS).reduce((a,b)=>a*b,1)
assert.equal(rarityWithBorders(card,five),card.rarity*fullMultiplier)
const input={cards:[{cardName:card.name,borders:five,mutationWeather:null,quantity:1,locked:false,lockedPosition:null}],statAuras:[],abilityAuras:[]}
assert.deepEqual(importInventoryCode(exportInventoryCode(input)),input,'Five-border ownership must survive export/import')
console.log('Emerald/Perfect Gem regression passed: 32 variants, 1000x Emerald, five-border inventory code.')
