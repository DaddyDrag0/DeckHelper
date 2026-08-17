import cards from '../src/data/cards'
import auras from '../src/data/auras'
import { depthSelectableAuras, depthSelectableCards, depthSelectableCardNames } from '../src/selectable'
import { sanitizeInventory } from '../src/storage'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const expectedCards = cards.filter((card) => !card.unobtainable || card.name === 'Conqueror')
const expectedAuras = auras.filter((aura) => !aura.unobtainable)
assert(depthSelectableCards.length === expectedCards.length, 'DeckHelper card catalog must match Depths selectable card count')
assert(depthSelectableAuras.length === expectedAuras.length, 'DeckHelper aura catalog must match Depths selectable aura count')
assert(depthSelectableCards.every((card) => !card.unobtainable || card.name === 'Conqueror'), 'Only Conqueror may bypass card unobtainable filtering')
assert(depthSelectableAuras.every((aura) => !aura.unobtainable), 'No unobtainable aura may appear in DeckHelper')

const conqueror = cards.find((card) => card.name === 'Conqueror')
if (conqueror) assert(depthSelectableCardNames.has('Conqueror'), 'Conqueror must remain selectable like the Depths calculator')

const blockedCard = cards.find((card) => card.unobtainable && card.name !== 'Conqueror')
const blockedAura = auras.find((aura) => aura.unobtainable)
const allowedCard = depthSelectableCards.find((card) => card.name !== 'Conqueror')
const allowedStatAura = depthSelectableAuras.find((aura) => aura.type === 'Stat')
const allowedAbilityAura = depthSelectableAuras.find((aura) => aura.type === 'Skill')
assert(blockedCard, 'Expected at least one unobtainable non-Conqueror card in source data')
assert(blockedAura, 'Expected at least one unobtainable aura in source data')
assert(allowedCard && allowedStatAura && allowedAbilityAura, 'Expected selectable cards and both aura types')

const cleaned = sanitizeInventory({
  cards: [
    { cardName: allowedCard.name, quantity: 1, borders: [], locked: false, lockedPosition: null },
    { cardName: blockedCard.name, quantity: 1, borders: [], locked: false, lockedPosition: null },
  ],
  statAuras: [
    { auraName: allowedStatAura.name, borders: ['Base'], locked: false },
    { auraName: blockedAura.name, borders: ['Base'], locked: false },
  ],
  abilityAuras: [
    { auraName: allowedAbilityAura.name, borders: ['Base'], locked: false },
    { auraName: blockedAura.name, borders: ['Base'], locked: false },
  ],
})
assert(cleaned.cards.some((card) => card.cardName === allowedCard.name), 'Selectable card should survive inventory sanitation')
assert(!cleaned.cards.some((card) => card.cardName === blockedCard.name), 'Unobtainable card should be stripped from saved inventory')
assert(cleaned.statAuras.some((aura) => aura.auraName === allowedStatAura.name), 'Selectable stat aura should survive inventory sanitation')
assert(cleaned.abilityAuras.some((aura) => aura.auraName === allowedAbilityAura.name), 'Selectable ability aura should survive inventory sanitation')
assert(!cleaned.statAuras.some((aura) => aura.auraName === blockedAura.name), 'Unobtainable aura should be stripped from stat inventory')
assert(!cleaned.abilityAuras.some((aura) => aura.auraName === blockedAura.name), 'Unobtainable aura should be stripped from ability inventory')

console.log(`Selectable catalog regression passed: ${depthSelectableCards.length} cards, ${depthSelectableAuras.length} auras`)
