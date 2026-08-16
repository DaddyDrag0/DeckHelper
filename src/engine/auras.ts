import auras from '../data/auras'
import type {
  AuraBorderName,
  AuraDefinition,
  AuraSelection,
  BattleBoosts,
  CombatCard,
} from '../types'

export const AURA_RARITY_MULTIPLIERS: Record<AuraBorderName, number> = {
  Platinum: 10,
  Crystal: 100,
  Galaxy: 1_000,
}

const AURA_TIERS: Record<AuraBorderName, number> = {
  Platinum: 1,
  Crystal: 2,
  Galaxy: 3,
}

const CUSTOM_SKILL_VALUES: Record<string, readonly [number, number, number, number]> = {
  Berserker: [5, 10, 15, 20],
  'Flame Wizard': [15, 25, 35, 50],
  Shielder: [2, 5, 7, 10],
  'Synth Human': [8, 10, 12, 15],
}

const BOOSTED_PACKS: Record<string, string> = {
  Neko: 'Anime',
  Shrinemaiden: 'Rising Sun',
  Shatbi: 'Egypt',
  Taoist: 'Immortal',
  Myhts: 'Cryptid',
  'Dinosaur King': 'Prehistoric',
}

const BOOSTED_WEATHERS: Record<string, string> = {
  Elohim: 'Rapture',
  Yggdrasil: 'Armageddon',
  Satan: 'Blood Rain',
  'Eclipse Chaser': 'Eclipse',
  Kala: 'Time Storm',
  Stormcaller: 'Storm',
  Iris: 'Aurora',
  Niflheim: 'Shroud',
  Khione: 'Snow',
  Astrologist: 'Meteor Shower',
  Disease: 'Virus',
}

export const TOY_CARD_NAMES = new Set([
  'Toy Bear',
  'Toy Car',
  'Toy Jack-in-the-Box',
  'Toy Nutcracker',
])

export function getAura(name: string | null | undefined): AuraDefinition | undefined {
  return name ? auras.find((aura) => aura.name === name) : undefined
}

export function getAuraTier(border?: AuraBorderName | null): number {
  return border ? AURA_TIERS[border] : 0
}

export function getAuraRarity(aura: AuraDefinition, border?: AuraBorderName | null): number {
  return aura.rarity * (border ? AURA_RARITY_MULTIPLIERS[border] : 1)
}

export function getStatAuraValue(aura: AuraDefinition, border?: AuraBorderName | null): number {
  const rarity = getAuraRarity(aura, border)
  return rarity > 0 ? Math.floor(Math.pow(2, Math.log10(rarity)) / 2) : 0
}

export function getSkillAuraValue(aura: AuraDefinition, border?: AuraBorderName | null): number {
  const tier = getAuraTier(border)
  const custom = CUSTOM_SKILL_VALUES[aura.name]
  if (custom) return custom[tier]
  return Number(aura.base || 0) + Number(aura.perLevel || 0) * tier
}

export function getAuraValue(aura: AuraDefinition, border?: AuraBorderName | null): number {
  return aura.type === 'Stat'
    ? getStatAuraValue(aura, border)
    : getSkillAuraValue(aura, border)
}

function isStatAuraBoosted(aura: AuraDefinition, card: CombatCard): boolean {
  if (aura.boostedCards?.includes(card.definition.name)) return true
  const pack = BOOSTED_PACKS[aura.name]
  if (pack && card.definition.pack === pack) return true
  const weather = BOOSTED_WEATHERS[aura.name]
  if (weather && card.definition.weather === weather) return true
  return false
}

export function statAuraPercentForCard(
  aura: AuraDefinition,
  card: CombatCard,
  border?: AuraBorderName | null,
): number {
  const base = getStatAuraValue(aura, border)
  if (aura.name === 'General Sun Tzu') return base
  return isStatAuraBoosted(aura, card) ? base * Number(aura.boostMult || 1) : base
}

export function applyStatAura(
  team: CombatCard[],
  selection?: AuraSelection | null,
): { aura?: AuraDefinition; value?: number } {
  const aura = getAura(selection?.auraName)
  if (!aura || aura.type !== 'Stat') return {}

  const baseValue = getStatAuraValue(aura, selection?.border)
  for (const card of team) {
    const value = statAuraPercentForCard(aura, card, selection?.border)
    const multiplier = 1 + value / 100

    card.hp *= multiplier
    card.maxHp *= multiplier
    if (aura.name !== 'General Sun Tzu') card.damage *= multiplier
  }

  return { aura, value: baseValue }
}

/**
 * Applies skill-aura effects that modify the entire deck before battle begins.
 * Direct combat-hook auras (Fate, Shielder, etc.) are handled by buildSkillAuraBoosts.
 */
export function applySkillAuraTeamEffects(
  team: CombatCard[],
  selection?: AuraSelection | null,
): { aura?: AuraDefinition; value?: number; implemented: boolean } {
  const aura = getAura(selection?.auraName)
  if (!aura || aura.type !== 'Skill') return { implemented: true }

  const value = getSkillAuraValue(aura, selection?.border)

  if (DIRECT_SKILL_BOOST_KEYS[aura.name]) {
    return { aura, value, implemented: true }
  }

  if (aura.name === 'Jurassic World') {
    const prehistoricCount = team.filter((card) => card.definition.pack === 'Prehistoric').length
    const multiplier = 1 + prehistoricCount * value / 100
    if (prehistoricCount > 0) {
      for (const card of team) {
        if (card.definition.pack !== 'Prehistoric') continue
        card.damage *= multiplier
        card.maxHp *= multiplier
        card.hp *= multiplier
      }
    }
    return { aura, value, implemented: true }
  }

  if (aura.name === 'Magical Elf') {
    const uniqueToys = new Set(
      team.filter((card) => TOY_CARD_NAMES.has(card.definition.name)).map((card) => card.definition.name),
    ).size
    const awakened = uniqueToys >= value
    for (const card of team) {
      if (!TOY_CARD_NAMES.has(card.definition.name)) continue
      card.counters.toyCount = uniqueToys
      if (awakened) card.flags.awakened = true
    }
    return { aura, value, implemented: true }
  }

  return { aura, value, implemented: false }
}

const DIRECT_SKILL_BOOST_KEYS: Record<string, keyof BattleBoosts> = {
  Fate: 'fate',
  Shielder: 'shielder',
  'Flame Wizard': 'flameWizard',
  Phantom: 'phantom',
  Berserker: 'berserker',
  'Synth Human': 'synthHuman',
  'End Times': 'endTimes',
  'Vampire Matron': 'vampireMatron',
}

export function buildSkillAuraBoosts(selection?: AuraSelection | null): {
  boosts: BattleBoosts
  aura?: AuraDefinition
  implemented: boolean
} {
  const aura = getAura(selection?.auraName)
  if (!aura || aura.type !== 'Skill') return { boosts: {}, implemented: true }

  const value = getSkillAuraValue(aura, selection?.border)
  const boosts: BattleBoosts = {
    skillAuraName: aura.name,
    skillAuraValue: value,
  }
  const key = DIRECT_SKILL_BOOST_KEYS[aura.name]
  if (key) {
    ;(boosts as unknown as Record<string, number>)[key] = value
    return { boosts, aura, implemented: true }
  }

  if (aura.name === 'Jurassic World' || aura.name === 'Magical Elf') {
    return { boosts, aura, implemented: true }
  }

  return { boosts, aura, implemented: false }
}

export const auraMechanics = {
  rarityMultipliers: AURA_RARITY_MULTIPLIERS,
  customSkillValues: CUSTOM_SKILL_VALUES,
  boostedPacks: BOOSTED_PACKS,
  boostedWeathers: BOOSTED_WEATHERS,
}
