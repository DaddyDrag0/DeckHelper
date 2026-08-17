import cards from './data/cards'
import auras from './data/auras'

export const isDepthSelectableCard = (card: (typeof cards)[number]): boolean => !card.unobtainable || card.name === 'Conqueror'
export const isDepthSelectableAura = (aura: (typeof auras)[number]): boolean => !aura.unobtainable

export const depthSelectableCards = cards.filter(isDepthSelectableCard)
export const depthSelectableAuras = auras.filter(isDepthSelectableAura)

export const depthSelectableCardNames = new Set(depthSelectableCards.map((card) => card.name))
export const depthSelectableStatAuraNames = new Set(depthSelectableAuras.filter((aura) => aura.type === 'Stat').map((aura) => aura.name))
export const depthSelectableAbilityAuraNames = new Set(depthSelectableAuras.filter((aura) => aura.type === 'Skill').map((aura) => aura.name))
