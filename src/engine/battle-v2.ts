import cards from '../data/cards'
import { cardAge } from '../data/ages'
import type {
  BattleBoosts,
  BattleDebug,
  BattleResult,
  BattleState,
  BattleTeam,
  CombatCard,
  DepthsEnemy,
  TeamLoadout,
} from '../types'
import { applySkillAuraTeamEffects, applyStatAura, buildSkillAuraBoosts, TOY_CARD_NAMES } from './auras'
import { SeededRng } from './rng'
import { getAttack, getHealth, getPower, rarityWithBorders } from './stats'
import { AVIAN_CARDS, DEMON_CARDS, DRAGON_CARDS, IMP_BOOSTED_CARDS, RNG_ABILITIES, UNDEAD_CARDS } from './combat-data'

const OTHER_TEAM: Record<BattleTeam, BattleTeam> = { Allies: 'Enemies', Enemies: 'Allies' }
// Ability resolution is an extremely hot path during high-floor batches. Avoid
// scanning the full card database every time an identity/ability is resolved.
const CARD_BY_NAME = new Map(cards.map((card) => [card.name, card] as const))

const FULLY_SUPPORTED = new Set([
  'Gathering', 'Remembrance', 'Am I Beautiful?', 'Persistent', 'Chimeric',
  'First Progenitor', 'Undead Practitioner', 'Big and Large', 'Patience', 'Blade',
  'Clawless', 'Catastrophe', 'Frail', 'Fight Dirty', 'Assassinate', 'Humanity\'s Spirit',
  'Infinite Dagger Works', 'Heart Legacy', 'Heavenly Might', 'Wail', 'Doom',
  'Favorable Odds', 'Combatant', 'Disarm', 'Explosion', 'Mind Rift', 'Evasion',
  'Armor', 'Puppy Eyes', 'Brittle', 'Mana Shield', 'Regenerate', 'Finesse',
  'Last Stand', 'Rage', 'Blinding Flash', 'Lifesteal', 'Undead', 'First Blood',
  'Berserk', 'Plunder', 'True Strike', 'Frigid Touch', 'Revive', 'Maelstrom',
  'Judgment', 'Self-Destruct', 'Super Strength', 'Eternity', 'Frozen Ashes',
  'Greater Might', 'Transcend Time', 'Cerberus', 'Sacrifice', 'Untouchable',
  'The Fall', 'Invincibility', 'Armageddon', 'Stardust Driver', 'Invisibility',
  'Divine Barrier', 'Quick Strike', 'Rapid Blows', 'Restoration', 'The Loser',
  'Eight Heads', 'Heavenly Ruler', 'Decapitate', 'Martial Will', 'Moonlight Beam',
  'Feeder', 'Absolute Sovereignty', 'Stalwart', 'Passion', 'Voracity', 'Vainglory',
  'Modesty', 'Decimate', 'Scale Armor', 'Draconic Heart', 'Prehistoric Wrath',
  'Hidden Curse', 'Perforating Mist', 'Turtle Shell', 'Snowbound', 'Shelter Obsession',
  'Fluffy Aggression', 'Speedy Progression', 'Behavioral Therapy', 'Red-Nosed Reindeer',
  'Sky Drop', 'Spikes', 'Shadow Predator', 'Apex Predator', 'Extinction', 'Aura Farm',
  'Mr. Piccolo', 'Sudden Demise', 'Hidden in the Depths',
  'Terror From Above', 'God of Thunder', 'All Father', 'Fire World', 'Into The Sun',
  'Eat The Moon', 'Dirty Claw', 'Death Embrace',
  'Blood Drinker', 'Drain Vitality', 'Fury of the White Tiger', 'Defraud',
  'Unforgiving', 'Grape Juice', 'Perfect Sacrifice', 'Guilt', 'Melt', 'Boiling Blood',
  'Run As Fast As You Can', 'Bind', 'Guerilla Warfare', 'Avalon', 'Reflective Shell',
  'Firepower', 'Chainsaw',
  'Third Eye', 'Influence', 'Art of War', 'Dominate', 'Lightning Slash', 'True Fang',
  'Book of Death', 'Holy Wrath', 'Telekinesis', 'Unlucky', 'Dragon Slayer', 'Outrank',
  'Golden Bell Shield', 'Frozen Wrath', 'Immortal', 'Haste', 'Tonic', 'Destiny Sight',
  'Eternal Devotion', "Unpaid 'Interns'", 'Infectious',
  "Hell's Curse", 'Final Tail', "Reaper's Luck", 'Decay', 'Purifying Fire',
  'Sacrificial Tides', 'Rejuvenate', 'Twilight Sparkle', 'Viral Breath', 'Herbal Alchemy',
  'Revenge', 'Northern Winds', 'Azure Dragon Wrath', 'Stampede', 'Ice Age',
  'Jaws', 'Lightning Strike', 'Danger Sense', 'Defensive Maneuver', 'First Tail',
  'Grind', 'World Creation', 'Melancholy', 'The World', 'Accelerate', 'Black Flash',
  'Limitless', "Monkey King's Rage",
  'A Pair of Two', 'Final Stand', 'Heard but not Seen', 'Lights Way', 'Eclipse',
  'Friendship', 'Fusion... HA!', 'Divine Mist', 'Dark Qi Manipulation',
  'Immortal Ascension', 'Hard Boiled', 'Tyrannospirit', 'Absolute Apex', 'Last Meal',
  'Stolen Spotlight', 'Horned Attack', 'Creep', 'Protection of Gods', 'Upheaval',
  'Deadly Ambush', 'Erosion', 'Divination', 'Insatiable', 'Poke the Beast',
  'Full Moon', 'Unholy Creature', 'The Underworld', 'Devilish', 'Chaos Destruction',
  'Beyond The Grave', 'Creation and Restoration', 'Dispel', 'Healing Miracle',
  'Laser Gun', 'Lotus Sutra', 'Origin', 'Outshine', 'Pandemic', 'Railgun',
  'Shiny Steal', 'Water Shield of Xuanwu', 'Constellar', "Pandora's Box",
  'ConstellarVirgo', 'ConstellarScorpio', 'ConstellarSagittarius',
  'ConstellarAquarius', 'ConstellarGemini', 'ConstellarTaurus', 'ConstellarCancer',
  'Perseverance', 'Oppressed', 'Dagger Storm', 'Desire', 'Starvation', 'Meow',
  'Playing God', 'Eternal Voyage', 'Haunt', "Witch's Curse", 'Blessing',
  'Happy Family', 'Lazy', "Housewife's Blessing", 'Flames of Rebirth', 'Paradox',
  'Hatred', 'Naughty or Nice?', 'Naughty List', 'Sacred Judgment', 'Toil',
  'Never Forgotten', 'Steal Christmas', 'Better Days', 'Pop-Up Impression',
  'Gobble', 'We Want YOU', 'Bloodlust', 'Flesh Eater', 'Forbidden Banquet',
  'Cosmic Maw', 'Hex', 'Order of the Cosmos', 'Honor',
  'Gehenna', 'Beyond Comprehension', 'Imminent Doom', 'Dance of Discord',
  'Snowscape', 'Plague', 'Spook', 'Perish', 'Blood Bath', 'Undying',
  'Mirror Image', 'Long Reach', 'Whooping', 'Shapeshifter', 'Heroes',
  'God of Trickery', 'Draconian', 'Safeguarding', 'Mother of Dragons', 'Reveal',
  'Jealousy', 'Nightmare Melody', 'Sap',
  'Bind Fate', 'Luminescent Veil', 'Ouroboros',
  'Cosmic Rivalry', 'Divine Ascension', 'Mastered Ascension', 'Kitchen', 'Six Realms Staff',
  'Twelve Devas Axe', 'Vajra Short Sword', 'Staff of Perfect Enlightenment', 'Shield of Ahimsa',
  'War Scythe', 'Great Nirvana Sword - Zero',
])

const BENCH_AFFECTING_UNSUPPORTED = new Set<string>()

const CONSTELLAR_ABILITIES = [
  'ConstellarVirgo', 'ConstellarScorpio', 'ConstellarSagittarius',
  'ConstellarAquarius', 'ConstellarGemini', 'ConstellarTaurus', 'ConstellarCancer',
] as const

const DODGE_ABILITIES = new Set([
  'Danger Sense', 'Deadly Ambush', 'Evasion', 'Untouchable', 'Guerilla Warfare',
  'The Loser', 'Invisibility', 'Limitless', 'Transcend Time', 'Snowbound',
  'Sky Drop', 'Shadow Predator', 'Run As Fast As You Can', 'Heard but not Seen',
  'Lights Way', 'Mastered Ascension',
])

const GENERAL_MOON_ZOO_ABILITY = cards.find((card) => card.name === 'General Moon Zoo')?.ability
// Pandora can gain abilities from the full card pool, including limited cards.
const PANDORA_ABILITY_POOL = [...new Set(
  cards.map((card) => card.ability).filter((name): name is string => Boolean(name)),
)].filter((name) =>
  name !== "Pandora's Box"
  && name !== GENERAL_MOON_ZOO_ABILITY
  && FULLY_SUPPORTED.has(name)
)

const RANDOM_CARD_POOL = cards.filter((card) =>
  !card.unobtainable && card.ability !== "Pandora's Box" && card.ability !== 'Constellar'
)
const NUWA_CREATABLE_POOL = cards.filter((card) => !card.expires && !card.unobtainable && card.name !== 'Nüwa')

interface Runtime {
  state: BattleState
  rng: SeededRng
  debug: BattleDebug
  captureDebug: boolean
  deathEpoch: number
}

function debugCard(card: CombatCard) {
  return {
    name: effectiveCardName(card) || card.definition.name,
    ability: ability(card),
    hp: card.hp,
    maxHp: card.maxHp,
    damage: card.damage,
    power: card.power,
  }
}

function pushDebugEvent(runtime: Runtime, event: BattleDebug['events'][number]) {
  if (!runtime.captureDebug) return
  if (runtime.debug.events.length >= 5000) runtime.debug.events.shift()
  runtime.debug.events.push(event)
}

function pushAbilityDebug(runtime: Runtime, card: CombatCard, detail: string) {
  pushDebugEvent(runtime, {
    turn: runtime.state.turn,
    type: 'ability',
    team: card.team,
    card: effectiveCardName(card) || card.definition.name,
    detail,
    hp: card.hp,
    maxHp: card.maxHp,
    damage: card.damage,
  })
}

type AbilityTraceCardState = {
  id: string
  name: string
  ability: string | null
  team: BattleTeam
  slot: number
  hp: number
  maxHp: number
  damage: number
  stunned: number
  confused: number
  burn: number
  weakness: boolean
  blind: boolean
  shield: number
  attacks: number
  extraTurns: number
  death: number
  bleed: number
  frostbite: number
  poisonPercent: number
  poisonFlat: number
  hpShield: number
  bindFatePair: number
  perishTurns: number
  divinationMoves: number
  extraTurnFlag: boolean
  awakened: boolean
  noRng: boolean
  eternalConfusion: boolean
  bonusAbilities: string
  sealed: boolean
  slowed: boolean
}

type AbilityTraceSnapshot = Map<string, AbilityTraceCardState>

function compactDebugNumber(value: number): string {
  if (!Number.isFinite(value)) return 'lethal'
  const sign = value < 0 ? '-' : ''
  const abs = Math.abs(value)
  const trim = (n: number) => n.toFixed(n >= 100 ? 0 : n >= 10 ? 1 : 2).replace(/\.?0+$/, '')
  if (abs >= 1e12) return sign + trim(abs / 1e12) + 't'
  if (abs >= 1e9) return sign + trim(abs / 1e9) + 'b'
  if (abs >= 1e6) return sign + trim(abs / 1e6) + 'm'
  if (abs >= 1e3) return sign + trim(abs / 1e3) + 'k'
  return sign + trim(abs)
}

function captureAbilityTrace(runtime: Runtime): AbilityTraceSnapshot {
  const snapshot: AbilityTraceSnapshot = new Map()
  for (const team of ['Allies', 'Enemies'] as BattleTeam[]) {
    runtime.state.teams[team].forEach((card, slot) => {
      snapshot.set(card.id, {
        id: card.id,
        name: effectiveCardName(card) || card.definition.name,
        ability: ability(card),
        team,
        slot,
        hp: card.hp,
        maxHp: card.maxHp,
        damage: card.damage,
        stunned: card.status.stunned,
        confused: card.status.confused,
        burn: card.status.burn,
        weakness: card.status.weakness,
        blind: card.status.blind,
        shield: card.status.shield,
        attacks: card.counters.attacks || 0,
        extraTurns: card.counters.extraTurns || 0,
        death: card.counters.death || 0,
        bleed: card.counters.bleed || 0,
        frostbite: card.counters.frostbite || 0,
        poisonPercent: card.counters.poisonPercent || 0,
        poisonFlat: card.counters.poisonFlat || 0,
        hpShield: card.counters.hpShield || 0,
        bindFatePair: card.counters.bindFatePair || 0,
        perishTurns: card.counters.perishTurns || 0,
        divinationMoves: card.counters.divinationMoves || 0,
        extraTurnFlag: Boolean(card.flags.extraTurn),
        awakened: Boolean(card.flags.awakened),
        noRng: Boolean(card.flags.noRng),
        eternalConfusion: Boolean(card.flags.eternalConfusion),
        bonusAbilities: (card.bonusAbilities || []).join(' + '),
        sealed: Boolean(card.flags.sealed),
        slowed: Boolean(card.flags.slowed),
      })
    })
  }
  return snapshot
}

function describeAbilityTrace(runtime: Runtime, before: AbilityTraceSnapshot, sourceCard: CombatCard): string[] {
  const after = captureAbilityTrace(runtime)
  const changes: string[] = []
  const changed = (a: number, b: number) => Math.abs(a - b) > Math.max(0.001, Math.abs(a) * 1e-9)
  const ids = new Set([...before.keys(), ...after.keys()])
  for (const id of ids) {
    const oldState = before.get(id)
    const newState = after.get(id)
    if (!oldState && newState) {
      changes.push(newState.name + ' entered slot ' + (newState.slot + 1))
      continue
    }
    if (oldState && !newState) {
      const isFallen = runtime.state.fallen[oldState.team].some((card) => card.id === id)
      if (!isFallen) changes.push(oldState.name + ' left the lineup')
      continue
    }
    if (!oldState || !newState) continue
    const label = id === sourceCard.id ? 'self' : newState.name
    if (oldState.slot !== newState.slot) changes.push(label + ' moved slot ' + (oldState.slot + 1) + ' → ' + (newState.slot + 1))
    if (oldState.name !== newState.name) changes.push(label + ' became ' + newState.name)
    if (oldState.ability !== newState.ability) changes.push(label + ' ability ' + (oldState.ability || 'none') + ' → ' + (newState.ability || 'none'))
    if (changed(oldState.damage, newState.damage)) changes.push(label + ' ATK ' + compactDebugNumber(oldState.damage) + ' → ' + compactDebugNumber(newState.damage))
    if (changed(oldState.maxHp, newState.maxHp)) changes.push(label + ' Max HP ' + compactDebugNumber(oldState.maxHp) + ' → ' + compactDebugNumber(newState.maxHp))
    if (changed(oldState.hp, newState.hp)) changes.push(label + ' HP ' + compactDebugNumber(oldState.hp) + ' → ' + compactDebugNumber(newState.hp))
    if (oldState.stunned !== newState.stunned) changes.push(label + ' stun ' + oldState.stunned + ' → ' + newState.stunned)
    if (oldState.confused !== newState.confused) changes.push(label + ' confusion ' + oldState.confused + ' → ' + newState.confused)
    if (oldState.burn !== newState.burn) changes.push(label + ' burn ' + oldState.burn + ' → ' + newState.burn)
    if (oldState.weakness !== newState.weakness) changes.push(label + (newState.weakness ? ' gained weakness' : ' lost weakness'))
    if (oldState.blind !== newState.blind) changes.push(label + (newState.blind ? ' was blinded' : ' blind ended'))
    if (oldState.shield !== newState.shield) changes.push(label + ' shields ' + oldState.shield + ' → ' + newState.shield)
    if (oldState.attacks !== newState.attacks) changes.push(label + ' bonus attacks ' + oldState.attacks + ' → ' + newState.attacks)
    if (oldState.extraTurns !== newState.extraTurns) changes.push(label + ' queued extra turns ' + oldState.extraTurns + ' → ' + newState.extraTurns)
    if (oldState.death !== newState.death) changes.push(label + ' death timer ' + oldState.death + ' → ' + newState.death)
    if (oldState.bleed !== newState.bleed) changes.push(label + ' bleed ' + oldState.bleed + ' → ' + newState.bleed)
    if (oldState.frostbite !== newState.frostbite) changes.push(label + ' frostbite ' + oldState.frostbite + ' → ' + newState.frostbite)
    if (oldState.poisonPercent !== newState.poisonPercent || oldState.poisonFlat !== newState.poisonFlat) changes.push(label + ' poison changed')
    if (oldState.hpShield !== newState.hpShield) changes.push(label + ' HP shield ' + compactDebugNumber(oldState.hpShield) + ' → ' + compactDebugNumber(newState.hpShield))
    if (oldState.bindFatePair !== newState.bindFatePair) changes.push(label + (newState.bindFatePair ? ' was bound by Bind Fate' : ' Bind Fate ended'))
    if (oldState.perishTurns !== newState.perishTurns) changes.push(label + ' Perish timer ' + oldState.perishTurns + ' → ' + newState.perishTurns)
    if (oldState.divinationMoves !== newState.divinationMoves) changes.push(label + ' Divination timer ' + oldState.divinationMoves + ' → ' + newState.divinationMoves)
    if (oldState.extraTurnFlag !== newState.extraTurnFlag) changes.push(label + (newState.extraTurnFlag ? ' gained an extra-turn trigger' : ' extra-turn trigger consumed'))
    if (oldState.awakened !== newState.awakened) changes.push(label + (newState.awakened ? ' awakened' : ' awakening ended'))
    if (oldState.noRng !== newState.noRng) changes.push(label + (newState.noRng ? ' RNG disabled' : ' RNG restored'))
    if (oldState.eternalConfusion !== newState.eternalConfusion) changes.push(label + (newState.eternalConfusion ? ' gained eternal confusion' : ' eternal confusion ended'))
    if (oldState.bonusAbilities !== newState.bonusAbilities) changes.push(label + ' bonus abilities ' + (oldState.bonusAbilities || 'none') + ' → ' + (newState.bonusAbilities || 'none'))
    if (oldState.sealed !== newState.sealed) changes.push(label + (newState.sealed ? ' ability sealed' : ' ability unsealed'))
    if (oldState.slowed !== newState.slowed) changes.push(label + (newState.slowed ? ' was slowed' : ' slow ended'))
  }
  return changes.length > 14 ? [...changes.slice(0, 14), '+' + (changes.length - 14) + ' more changes'] : changes
}

function runAbilityTrace<T>(runtime: Runtime, card: CombatCard, abilityName: string | null, fn: () => T): T {
  if (!runtime.captureDebug || !abilityName) return fn()
  const before = captureAbilityTrace(runtime)
  const eventStart = runtime.debug.events.length
  const result = fn()
  const cardName = effectiveCardName(card) || card.definition.name
  const alreadyLogged = runtime.debug.events.slice(eventStart).some((event) => event.type === 'ability' && event.card === cardName)
  if (!alreadyLogged) {
    const changes = describeAbilityTrace(runtime, before, card)
    if (changes.length) pushAbilityDebug(runtime, card, abilityName + ': ' + changes.join('; ') + '.')
  }
  return result
}

function definition(name: string) {
  return CARD_BY_NAME.get(name)
}

function effectiveCardName(card: CombatCard | undefined): string | null {
  return card?.identityOverride ?? card?.definition.name ?? null
}

function ability(card: CombatCard | undefined): string | null {
  if (!card) return null
  if (card.abilityOverride !== undefined) return card.abilityOverride ?? null
  const name = effectiveCardName(card)
  if (!name) return null
  if (card.identityOverride && name === 'Longmu') return null
  return definition(name)?.ability ?? card.definition.ability ?? null
}

function abilityNames(card: CombatCard | undefined): string[] {
  if (!card) return []
  return [...new Set([ability(card), ...(card.bonusAbilities || [])].filter((name): name is string => Boolean(name)))]
}

function activeBonusAbilities(card: CombatCard): string[] {
  const root = card.definition.ability
  if ((root === "Pandora's Box" || root === 'Heroes') && ability(card) === root) {
    return card.bonusAbilities || []
  }
  if (root === 'Six Realms Staff' && ability(card) === 'Great Nirvana Sword - Zero') {
    return card.bonusAbilities || []
  }
  return []
}

function withAbility<T>(card: CombatCard, name: string, fn: () => T): T {
  const previous = card.abilityOverride
  card.abilityOverride = name
  try {
    return fn()
  } finally {
    card.abilityOverride = previous
  }
}

function randomBattleCard(runtime: Runtime) {
  return RANDOM_CARD_POOL[Math.floor(runtime.rng.next() * RANDOM_CARD_POOL.length)] || cards[0]
}

function randomConstellarAbility(runtime: Runtime): string {
  return CONSTELLAR_ABILITIES[Math.floor(runtime.rng.next() * CONSTELLAR_ABILITIES.length)]
}

function resolvePandoraGainedAbility(runtime: Runtime, card: CombatCard, name: string): string {
  if (name === 'Constellar') return randomConstellarAbility(runtime)
  if (name === 'The Underworld') {
    const copied = [...runtime.state.fallen[card.team]].reverse()
      .flatMap((fallen) => abilityNames(fallen))
      .find((candidate) => candidate !== 'The Underworld' && candidate !== "Pandora's Box")
    if (copied) return copied
  }
  return name
}

function constellarTaurusFactor(card: CombatCard): number {
  if (card.maxHp <= 0) return 2.5
  return Math.min(2.5, 1 + (1 - Math.max(0, card.hp) / card.maxHp) * 1.5)
}

function primaryBorder(card: CombatCard): '' | 'Platinum' | 'Crystal' | 'Ruby' | 'Galaxy' {
  if (card.borders.includes('Galaxy')) return 'Galaxy'
  if (card.borders.includes('Ruby')) return 'Ruby'
  if (card.borders.includes('Crystal')) return 'Crystal'
  if (card.borders.includes('Platinum')) return 'Platinum'
  return ''
}

function borderTier(card: CombatCard): number {
  const border = primaryBorder(card)
  return border === 'Galaxy' ? 30 : border === 'Ruby' ? 25 : border === 'Crystal' ? 20 : border === 'Platinum' ? 10 : 0
}

function toyBearAwakenedMultiplier(card: CombatCard, fallenToys: number): number {
  const border = primaryBorder(card)
  const current = border === 'Galaxy' ? 64 : border === 'Ruby' ? 32 : border === 'Crystal' ? 16 : border === 'Platinum' ? 4 : 1
  const ladder = [1, 4, 16, 32, 64]
  const start = Math.max(0, ladder.indexOf(current))
  return ladder[Math.min(ladder.length - 1, start + fallenToys)] / current
}

function alive(card: CombatCard | undefined): card is CombatCard {
  return Boolean(card && card.hp > 0 && !card.dead)
}

function boostStats(card: CombatCard, mult: number) {
  card.damage *= mult
  card.maxHp *= mult
  card.hp *= mult
}

function stealStats(from: CombatCard, to: CombatCard, fraction: number) {
  const stolenDamage = Math.max(0, from.damage * fraction)
  const stolenMaxHp = Math.max(0, from.maxHp * fraction)
  const stolenHp = Math.max(0, from.hp * fraction)
  from.damage = Math.max(0, from.damage - stolenDamage)
  from.maxHp = Math.max(1, from.maxHp - stolenMaxHp)
  from.hp = Math.max(0, Math.min(from.maxHp, from.hp - stolenHp))
  to.damage += stolenDamage
  to.maxHp += stolenMaxHp
  to.hp += stolenHp
}

function statusProtected(runtime: Runtime, team: BattleTeam): boolean {
  return runtime.state.teams[team].some((card) => hasAbility(runtime, card, 'Protection of Gods'))
}

function luminescentVeilHolder(runtime: Runtime, team: BattleTeam): CombatCard | undefined {
  return runtime.state.teams[team].find((card) => alive(card) && hasAbility(runtime, card, 'Luminescent Veil'))
}

function luminescentVeilCanAffect(attacker: CombatCard): boolean {
  const name = effectiveCardName(attacker) || attacker.definition.name
  return name !== 'Kira' && name !== 'Judgment Day'
}

function clearSkillAura(runtime: Runtime, team: BattleTeam) {
  const boosts = runtime.state.boosts[team]
  runtime.state.boosts[team] = {
    statAuraName: boosts.statAuraName,
    statAuraValue: boosts.statAuraValue,
    fossils: boosts.fossils || 0,
    composerCount: boosts.composerCount,
    composerThreshold: boosts.composerThreshold,
    noAbilities: boosts.noAbilities,
  }
}

function randomCreatableCard(runtime: Runtime) {
  // OG server source: Nüwa can create any non-expired, obtainable card except Nüwa itself.
  // Pack and Boss are not separate exclusions here; Unobtainable/Expires are the source gates.
  return NUWA_CREATABLE_POOL[Math.floor(runtime.rng.next() * NUWA_CREATABLE_POOL.length)] || cards[0]
}

function waterShield(runtime: Runtime, team: BattleTeam, target: CombatCard): CombatCard | undefined {
  return runtime.state.teams[team].find((card) => card !== target && hasAbility(runtime, card, 'Water Shield of Xuanwu'))
}

function resetCombatStats(card: CombatCard) {
  const normalDamage = card.counters.normalDamage
  const normalMaxHp = card.counters.normalMaxHp
  if (normalDamage > 0) card.damage = normalDamage
  if (normalMaxHp > 0) {
    card.maxHp = normalMaxHp
    card.hp = Math.min(card.hp, card.maxHp)
  }
}

function clearStatuses(card: CombatCard) {
  card.status.stunned = 0
  card.status.confused = 0
  card.status.burn = 0
  card.status.weakness = false
  card.status.blind = false
  card.counters.bleed = 0
  card.counters.frostbite = 0
  card.counters.poisonFlat = 0
  card.counters.poisonPercent = 0
  card.counters.weaknessTurns = 0
}

function makePlayerCard(name: string, borders: CombatCard['borders'], index: number): CombatCard | null {
  const card = definition(name)
  if (!card) return null
  const power = getPower(card, borders)
  const hp = getHealth(card, borders)
  return {
    id: `Allies:${index}:${name}`,
    definition: card,
    team: 'Allies',
    index,
    borders: [...borders],
    power,
    hp,
    maxHp: hp,
    damage: getAttack(card, borders),
    entered: false,
    dead: false,
    boss: Boolean(card.boss),
    status: { stunned: 0, confused: 0, burn: 0, weakness: false, blind: false, shield: 0 },
    flags: {},
    counters: {},
  }
}

function makeEnemyCard(enemy: DepthsEnemy, index: number): CombatCard {
  return {
    id: `Enemies:${index}:${enemy.card.name}`,
    definition: enemy.card,
    team: 'Enemies',
    index,
    borders: [],
    power: enemy.power,
    hp: enemy.health,
    maxHp: enemy.health,
    damage: enemy.attack,
    entered: false,
    dead: false,
    boss: Boolean(enemy.card.boss),
    status: { stunned: 0, confused: 0, burn: 0, weakness: false, blind: false, shield: 0 },
    flags: {},
    counters: {},
  }
}

function cloneAtFraction(source: CombatCard, fraction: number, serial: number): CombatCard {
  return {
    ...source,
    id: `${source.team}:copy:${serial}:${source.definition.name}`,
    hp: source.hp * fraction,
    maxHp: source.maxHp * fraction,
    damage: source.damage * fraction,
    power: source.power * fraction,
    entered: false,
    dead: false,
    identityOverride: undefined,
    status: { stunned: 0, confused: 0, burn: 0, weakness: false, blind: false, shield: 0 },
    flags: { paired: true },
    counters: { normalDamage: source.damage * fraction },
  }
}

function noteUnsupported(state: BattleState, card: CombatCard | undefined) {
  for (const name of abilityNames(card)) {
    if (!FULLY_SUPPORTED.has(name)) state.unsupportedAbilities.add(name)
  }
}

function active(runtime: Runtime, team: BattleTeam) {
  return runtime.state.teams[team][0]
}

function hasAbility(runtime: Runtime, card: CombatCard | undefined, name: string): boolean {
  if (!card || card.dead || card.flags.sealed) return false
  const abilityLocked = (runtime.state.boosts[card.team].noAbilities || 0) > 0
  const friendshipPassive = name === 'Friendship' && card.definition.ability === 'Friendship'
  if (abilityLocked && !friendshipPassive) return false
  const opposingCard = active(runtime, OTHER_TEAM[card.team])
  const ownName = effectiveCardName(card)
  const opposingName = effectiveCardName(opposingCard)
  let matched = abilityNames(card).includes(name)
  if (!matched && ability(card) === 'Jealousy' && opposingCard && opposingName !== 'Amenhotep') {
    matched = abilityNames(opposingCard).includes(name)
  }
  if (!matched) return false
  if (opposingCard && ability(opposingCard) === 'Jealousy' && ownName !== 'Amenhotep') return false
  const honorActive = [active(runtime, 'Allies'), active(runtime, 'Enemies')].some((activeCard) =>
    activeCard && !activeCard.dead && !activeCard.flags.sealed && abilityNames(activeCard).includes('Honor')
  )
  if (honorActive && name !== 'Honor') return false
  const enemy = runtime.state.boosts[OTHER_TEAM[card.team]]
  if (enemy.endTimes && runtime.rng.next() < enemy.endTimes / 100) {
    pushAbilityDebug(runtime, card, `End Times made ${name} fail.`)
    return false
  }
  return true
}

function resolvedAbility(runtime: Runtime, card: CombatCard | undefined): string | null {
  const raw = ability(card)
  if (!card || !raw) return raw
  const opposingCard = active(runtime, OTHER_TEAM[card.team])
  if (raw === 'Jealousy' && opposingCard && effectiveCardName(opposingCard) !== 'Amenhotep') {
    return ability(opposingCard)
  }
  if (opposingCard && ability(opposingCard) === 'Jealousy' && effectiveCardName(card) !== 'Amenhotep') return null
  return raw
}

function rand(runtime: Runtime, team: BattleTeam): number {
  const activeA = runtime.state.teams.Allies[0]
  const activeE = runtime.state.teams.Enemies[0]
  if (hasAbility(runtime, activeA, 'Unlucky') || hasAbility(runtime, activeE, 'Unlucky')) return 0
  if (runtime.state.teams[team][0]?.flags.noRng) return 0
  let roll = runtime.rng.next()
  const fate = runtime.state.boosts[team].fate
  if (fate && runtime.rng.next() < fate / 100) roll = Math.max(roll, runtime.rng.next())
  return Math.min(1, roll)
}

function buildBoosts(loadout: TeamLoadout, state: BattleState): Record<BattleTeam, BattleBoosts> {
  const boosts: Record<BattleTeam, BattleBoosts> = { Allies: { fossils: 0 }, Enemies: { fossils: 0 } }
  const skill = buildSkillAuraBoosts(loadout.abilityAura)
  boosts.Allies = { fossils: 0, ...skill.boosts }
  if (skill.aura && !skill.implemented) state.unsupportedAbilities.add(`Aura: ${skill.aura.name}`)
  return boosts
}

function applyDeckPassives(team: CombatCard[]) {
  const moonZoo = team.filter((card) => card.definition.name === 'General Moon Zoo').length
  const julius = team.filter((card) => card.definition.name === 'Julius Leader').length
  const damageMult = (1 + moonZoo * 0.1) * (1 + julius * 0.2)
  if (damageMult !== 1) for (const card of team) card.damage *= damageMult
}

function applyDraconianSetup(team: CombatCard[]) {
  let motherOfDragons = false
  for (let index = 0; index < team.length; index++) {
    const card = team[index]
    if (card.definition.ability !== 'Draconian') continue
    card.abilityOverride = index === 0 ? 'Safeguarding' : 'Mother of Dragons'
    if (index === 0) card.status.shield = Math.max(card.status.shield, 1)
    else motherOfDragons = true
  }
  if (motherOfDragons) {
    for (const card of team) {
      if (DRAGON_CARDS.has(card.definition.name)) card.status.shield = Math.max(card.status.shield, 2)
    }
  }
}

export function createBattleStateV2(loadout: TeamLoadout, enemies: DepthsEnemy[]): BattleState {
  const allies = loadout.cards
    .map((slot, index) => makePlayerCard(slot.cardName, slot.borders, index + 1))
    .filter((card): card is CombatCard => Boolean(card))
  const enemyCards = enemies.map((enemy, index) => makeEnemyCard(enemy, index + 1))

  const state: BattleState = {
    teams: { Allies: allies, Enemies: enemyCards },
    fallen: { Allies: [], Enemies: [] },
    boosts: { Allies: {}, Enemies: {} },
    turn: 0,
    moving: 'Allies',
    unsupportedAbilities: new Set<string>(),
  }

  applyDeckPassives(allies)
  applyDeckPassives(enemyCards)
  applyDraconianSetup(allies)
  applyDraconianSetup(enemyCards)
  const stat = applyStatAura(allies, loadout.statAura)
  const skillTeam = applySkillAuraTeamEffects(allies, loadout.abilityAura)
  state.boosts = buildBoosts(loadout, state)
  for (const team of ['Allies', 'Enemies'] as BattleTeam[]) {
    const composerCount = state.teams[team].filter((card) => card.definition.ability === 'Nightmare Melody').length
    if (composerCount > 0) {
      state.boosts[team].composerCount = composerCount
      state.boosts[team].composerThreshold = 1
    }
  }
  if (skillTeam.aura && !skillTeam.implemented) state.unsupportedAbilities.add(`Aura: ${skillTeam.aura.name}`)
  if (stat.aura) {
    state.boosts.Allies.statAuraName = stat.aura.name
    state.boosts.Allies.statAuraValue = stat.value
  }

  for (const card of [...allies, ...enemyCards]) {
    card.counters.normalDamage = card.damage
    card.counters.normalMaxHp = card.maxHp
    if (BENCH_AFFECTING_UNSUPPORTED.has(ability(card) || '')) noteUnsupported(state, card)
  }
  return state
}

function resolveConstellarArts(runtime: Runtime) {
  for (const team of ['Allies', 'Enemies'] as BattleTeam[]) {
    for (const card of runtime.state.teams[team]) {
      if (card.definition.ability === 'Constellar' && !card.abilityOverride) {
        card.abilityOverride = randomConstellarAbility(runtime)
      }
    }
    const astraeusCount = runtime.state.teams[team].filter((card) => card.definition.name === 'Astraeus').length
    for (const card of runtime.state.teams[team]) {
      if (ability(card) === 'ConstellarGemini' && !card.flags.constellarGeminiApplied) {
        card.flags.constellarGeminiApplied = true
        boostStats(card, 1 + astraeusCount * 0.5)
      }
    }
  }
}

function performEntryAttack(runtime: Runtime, card: CombatCard, mult = 1, allEnemies = false) {
  const enemyTeam = OTHER_TEAM[card.team]
  const first = active(runtime, enemyTeam)
  if (!first || !alive(card)) return
  const dealt = dealDamage(runtime, card, first, mult)
  if (allEnemies && dealt > 0) {
    for (const target of runtime.state.teams[enemyTeam].slice(1)) target.hp -= Math.min(target.hp, dealt)
  }
  resolveDeaths(runtime)
}

function onEntry(runtime: Runtime, card: CombatCard) {
  if (card.entered || !alive(card)) return
  card.entered = true
  card.flags.appearedOnField = true
  noteUnsupported(runtime.state, card)
  const enemyTeam = OTHER_TEAM[card.team]
  const enemy = active(runtime, enemyTeam)
  if (!enemy) return

  if (enemy !== card && hasAbility(runtime, enemy, 'Desire')) runAbilityTrace(runtime, enemy, 'Desire', () => stealStats(card, enemy, 0.1))
  if (enemy !== card && hasAbility(runtime, enemy, 'Cosmic Maw')) runAbilityTrace(runtime, enemy, 'Cosmic Maw', () => stealStats(card, enemy, 0.2))
  if (enemy !== card && enemy.flags.awakened && hasAbility(runtime, enemy, 'Pop-Up Impression') && !statusProtected(runtime, card.team)) {
    runAbilityTrace(runtime, enemy, 'Pop-Up Impression', () => {
      card.status.confused = Math.max(card.status.confused, enemy.counters.toyCount || 1)
    })
  }

  let name = resolvedAbility(runtime, card)
  if (!name || !hasAbility(runtime, card, name)) return

  if (name === "Pandora's Box" && !card.flags.pandoraRolled) {
    card.flags.pandoraRolled = true
    const chosen: string[] = []
    let attempts = 0
    while (chosen.length < 2 && attempts++ < 100 && PANDORA_ABILITY_POOL.length) {
      const raw = PANDORA_ABILITY_POOL[Math.floor(runtime.rng.next() * PANDORA_ABILITY_POOL.length)]
      const gained = resolvePandoraGainedAbility(runtime, card, raw)
      if (gained !== "Pandora's Box" && !chosen.includes(gained)) chosen.push(gained)
    }
    card.bonusAbilities = chosen
    if (runtime.captureDebug) pushDebugEvent(runtime, {
      turn: runtime.state.turn,
      type: 'ability',
      team: card.team,
      card: effectiveCardName(card) || card.definition.name,
      detail: `Pandora's Box rolled: ${chosen.join(' + ') || 'No abilities'}`,
      hp: card.hp,
      maxHp: card.maxHp,
      damage: card.damage,
    })
    for (const gained of chosen) {
      withAbility(card, gained, () => {
        card.entered = false
        onEntry(runtime, card)
      })
    }
    card.entered = true
    return
  }

  if (name === 'Heroes') {
    const chosen = runtime.state.fallen[card.team].slice(0, 2)
      .filter((fallen) => fallen.definition.name !== card.definition.name && fallen.definition.name !== 'Legends')
      .map((fallen) => fallen.definition.ability)
      .filter((gained): gained is string => Boolean(gained))
    if (chosen.length) card.bonusAbilities = [...new Set(chosen)]
    for (const gained of activeBonusAbilities(card)) {
      withAbility(card, gained, () => {
        card.entered = false
        onEntry(runtime, card)
      })
    }
    card.entered = true
    return
  }

  if (name === 'Constellar') {
    card.abilityOverride = randomConstellarAbility(runtime)
    name = ability(card)
    if (name === 'ConstellarGemini' && !card.flags.constellarGeminiApplied) {
      card.flags.constellarGeminiApplied = true
      const count = runtime.state.teams[card.team].filter((ally) => ally.definition.name === 'Astraeus').length
      boostStats(card, 1 + count * 0.5)
    }
    card.entered = false
    onEntry(runtime, card)
    return
  }

  if (name === 'The Underworld') {
    const copied = [...runtime.state.fallen[card.team]].reverse()
      .map((fallen) => ability(fallen))
      .find((candidate) => candidate && candidate !== 'The Underworld')
    if (copied) {
      card.abilityOverride = copied
      card.entered = false
      onEntry(runtime, card)
      return
    }
  }

  if (name === 'Six Realms Staff' && !card.flags.sixRealmsRolled) {
    card.flags.sixRealmsRolled = true
    const weapons = [
      'Twelve Devas Axe', 'Vajra Short Sword', 'Staff of Perfect Enlightenment',
      'Shield of Ahimsa', 'War Scythe', 'Great Nirvana Sword - Zero',
    ]
    card.abilityOverride = weapons[Math.floor(runtime.rng.next() * weapons.length)]
    card.entered = false
    onEntry(runtime, card)
    return
  }

  if (name === 'Great Nirvana Sword - Zero' && !card.flags.zeroWeaponsRolled) {
    card.flags.zeroWeaponsRolled = true
    const pool = ['Twelve Devas Axe', 'Vajra Short Sword', 'Staff of Perfect Enlightenment', 'Shield of Ahimsa', 'War Scythe']
    const firstIndex = Math.floor(runtime.rng.next() * pool.length)
    const first = pool[firstIndex]
    const remaining = pool.filter((_, index) => index !== firstIndex)
    const second = remaining[Math.floor(runtime.rng.next() * remaining.length)]
    card.bonusAbilities = [first, second]
    for (const gained of card.bonusAbilities) {
      withAbility(card, gained, () => {
        card.entered = false
        onEntry(runtime, card)
      })
    }
    card.entered = true
    return
  }

  const entryTraceBefore = runtime.captureDebug ? captureAbilityTrace(runtime) : null
  const entryTraceEventStart = runtime.debug.events.length

  switch (name) {
    case 'Bind Fate': {
      const firstTwo = runtime.state.teams[enemyTeam].filter(alive).slice(0, 2)
      if (firstTwo.length === 2) {
        const pair = runtime.state.turn * 1000 + Math.max(1, card.index)
        firstTwo[0].counters.bindFatePair = pair
        firstTwo[1].counters.bindFatePair = pair
      }
      break
    }
    case 'Ouroboros': {
      if (!card.flags.ouroborosActive) {
        let stolenDamage = 0
        let stolenMaxHp = 0
        let stolenHp = 0
        for (const teamName of ['Allies', 'Enemies'] as BattleTeam[]) {
          for (const other of runtime.state.teams[teamName]) {
            if (other === card || !alive(other)) continue
            const oldDamage = other.damage
            const oldMaxHp = other.maxHp
            const oldHp = other.hp
            other.damage = Math.max(0, oldDamage * 0.95)
            other.maxHp = Math.max(1, oldMaxHp * 0.95)
            other.hp = Math.max(0, Math.min(other.maxHp, oldHp * 0.95))
            stolenDamage += oldDamage - other.damage
            stolenMaxHp += oldMaxHp - other.maxHp
            stolenHp += oldHp - other.hp
          }
        }
        card.damage += stolenDamage
        card.maxHp += stolenMaxHp
        card.hp += stolenHp
        card.counters.ouroborosBonusDamage = stolenDamage
        card.counters.ouroborosBonusMaxHp = stolenMaxHp
        card.counters.ouroborosBonusHp = stolenHp
        card.counters.ouroborosTurns = 3
        card.flags.ouroborosActive = true
      }
      break
    }
    case 'Perseverance':
      if (!card.flags.perseveranceBoosted) {
        card.flags.perseveranceBoosted = true
        card.maxHp *= 100
        card.hp *= 100
      }
      break
    case 'ConstellarVirgo':
      card.counters.hpShield = (card.counters.hpShield || 0) + card.maxHp * 2
      break
    case 'ConstellarGemini':
      if (!card.flags.constellarGeminiApplied) {
        card.flags.constellarGeminiApplied = true
        const count = runtime.state.teams[card.team].filter((ally) => ally.definition.name === 'Astraeus').length
        boostStats(card, 1 + count * 0.5)
      }
      break
    case 'Gathering': {
      const count = runtime.state.teams[card.team].length + runtime.state.fallen[card.team].length
      card.damage *= Math.pow(1.5, count)
      break
    }
    case 'Remembrance': {
      const count = runtime.state.fallen[card.team].length
      if (count) boostStats(card, Math.pow(1.5, count))
      break
    }
    case 'Friendship': {
      const unique = new Set(
        [...runtime.state.teams[card.team], ...runtime.state.fallen[card.team]]
          .filter((ally) => ability(ally) === 'Friendship')
          .map((ally) => ally.definition.name),
      ).size
      if (unique > 0) boostStats(card, 1 + unique * 0.4)
      break
    }
    case "Humanity's Spirit": {
      const count = runtime.state.fallen[card.team].length
      if (count) boostStats(card, 1 + count * 0.3)
      break
    }
    case 'Perforating Mist': {
      const fallenDamage = runtime.state.fallen[card.team].reduce((sum, fallen) => sum + fallen.damage, 0)
      if (fallenDamage > 0) card.damage += fallenDamage
      break
    }
    case 'Beyond Comprehension':
      if (!statusProtected(runtime, enemy.team)) {
        enemy.flags.eternalConfusion = true
        enemy.status.confused = Math.max(enemy.status.confused, 1)
      }
      break
    case 'Dance of Discord': {
      const deck = runtime.state.teams[enemyTeam]
      if (deck.length >= 2) {
        const firstIndex = Math.floor(runtime.rng.next() * deck.length)
        let secondIndex = Math.floor(runtime.rng.next() * (deck.length - 1))
        if (secondIndex >= firstIndex) secondIndex += 1
        const first = deck[firstIndex]
        const second = deck[secondIndex]
        ;[first.damage, second.damage] = [second.damage, first.damage]
        ;[first.maxHp, second.maxHp] = [second.maxHp, first.maxHp]
        ;[first.hp, second.hp] = [Math.min(second.hp, second.maxHp), Math.min(first.hp, first.maxHp)]
        boostStats(first, 0.85)
        boostStats(second, 0.85)
        ;[deck[firstIndex], deck[secondIndex]] = [deck[secondIndex], deck[firstIndex]]
      }
      break
    }
    case 'Snowscape': {
      if (statusProtected(runtime, enemy.team)) break
      const roll = Math.floor(rand(runtime, card.team) * 3)
      if (roll <= 0) enemy.counters.frostbite = Math.max(enemy.counters.frostbite || 0, 3)
      else if (roll === 1) {
        enemy.flags.slowed = true
        enemy.counters.slowTurns = Math.max(enemy.counters.slowTurns || 0, 3)
        enemy.counters.slowed = 0
      } else enemy.status.stunned = Math.max(enemy.status.stunned, 3)
      break
    }
    case 'Spook':
      if (AVIAN_CARDS.has(enemy.definition.name) && !statusProtected(runtime, enemy.team)) {
        enemy.status.confused = Math.max(enemy.status.confused, 3)
      }
      break
    case 'Perish':
      if (!statusProtected(runtime, enemy.team)) enemy.status.stunned = Math.max(enemy.status.stunned, 1)
      card.counters.perishTurns = 3
      break
    case 'Desire':
      break
    case 'Cosmic Maw':
      stealStats(enemy, card, 0.2)
      break
    case 'Sap':
      if (rand(runtime, card.team) > 1 - card.damage / enemy.damage) {
        card.damage += enemy.damage * 0.5
        enemy.damage *= 0.5
      }
      break
    case 'Haunt': {
      const damageLoss = card.damage * 0.35
      const hpLoss = card.maxHp * 0.35
      enemy.damage = Math.max(0, enemy.damage - damageLoss)
      enemy.maxHp = Math.max(1, enemy.maxHp - hpLoss)
      enemy.hp = Math.max(0, Math.min(enemy.maxHp, enemy.hp - hpLoss))
      break
    }
    case 'Hex':
      enemy.flags.noRng = true
      break
    case 'Order of the Cosmos':
      // OG server source stores this as a team-wide NoAbilities counter.
      // It lasts for three turns TAKEN by the affected team, not three turns per card.
      runtime.state.boosts[enemyTeam].noAbilities = 3
      pushAbilityDebug(runtime, card, `Order of the Cosmos disabled ${enemyTeam === 'Enemies' ? 'enemy' : 'player'} abilities for their next 3 turns.`)
      break
    case 'Mind Rift':
      if (card.damage > enemy.damage / 4) enemy.status.confused = 3
      break
    case 'Am I Beautiful?':
      enemy.status.confused = 2
      break
    case 'God of Trickery': {
      const randomCard = randomBattleCard(runtime)
      enemy.identityOverride = randomCard.name
      enemy.abilityOverride = undefined
      card.identityOverride = enemy.definition.name
      card.abilityOverride = undefined
      break
    }
    case 'Fire World':
      for (const target of runtime.state.teams[enemyTeam]) target.status.burn = 3
      break
    case 'Book of Death':
      enemy.counters.death = 2
      break
    case 'Erosion': {
      const auraName = runtime.state.boosts[enemyTeam].skillAuraName
      if (rand(runtime, card.team) < 0.5) {
        clearSkillAura(runtime, enemyTeam)
        pushAbilityDebug(runtime, card, 'Erosion succeeded' + (auraName ? ' — disabled ' + auraName + '.' : ', but there was no enemy ability aura to disable.'))
      } else if (auraName) pushAbilityDebug(runtime, card, 'Erosion failed — ' + auraName + ' stayed active.')
      break
    }
    case 'Divination':
      card.counters.divinationMoves = 5
      break
    case 'Creation and Restoration': {
      const createdDefinition = randomCreatableCard(runtime)
      const created: CombatCard = {
        ...card,
        id: `${card.team}:created:${runtime.state.turn}:${createdDefinition.name}`,
        definition: createdDefinition,
        index: runtime.state.teams[card.team].length + 1,
        borders: [],
        // OG server source rebuilds the spawned card from Nüwa's raw Power, not Nüwa's
        // current aura/battle-modified HP/ATK and not the spawned card's HP multiplier.
        hp: Math.ceil(card.power),
        maxHp: Math.ceil(card.power),
        damage: Math.ceil(card.power / 2),
        power: card.power,
        entered: false,
        dead: false,
        identityOverride: undefined,
        abilityOverride: undefined,
        bonusAbilities: undefined,
        status: { stunned: 0, confused: 0, burn: 0, weakness: false, blind: false, shield: 0 },
        flags: {},
        counters: { normalDamage: Math.ceil(card.power / 2), normalMaxHp: Math.ceil(card.power) },
      }
      runtime.state.teams[card.team].push(created)
      pushDebugEvent(runtime, {
        turn: runtime.state.turn,
        type: 'spawn',
        team: card.team,
        card: createdDefinition.name,
        detail: 'Creation and Restoration: Nüwa created ' + createdDefinition.name + ' at raw Power ' + Math.ceil(card.power),
        hp: created.hp,
        maxHp: created.maxHp,
        damage: created.damage,
      })
      break
    }
    case 'Dispel':
      resetCombatStats(enemy)
      break
    case 'Pandemic':
      for (const target of runtime.state.teams[enemyTeam]) {
        if (statusProtected(runtime, target.team)) continue
        target.counters.poisonPercent = Math.min(target.counters.poisonPercent || 0, -0.075)
        target.counters.poisonTurns = Math.max(target.counters.poisonTurns || 0, 2)
      }
      break
    case 'Divine Mist':
      if (rand(runtime, card.team) < 0.7) {
        const hp = getHealth(enemy.definition, [])
        enemy.power = getPower(enemy.definition, [])
        enemy.damage = getAttack(enemy.definition, [])
        enemy.maxHp = hp
        enemy.hp = hp
      }
      break
    case 'Chimeric':
      boostStats(card, 4)
      break
    case 'Puppy Eyes':
      enemy.damage *= 0.85
      break
    case 'Catastrophe':
      enemy.damage *= 0.6
      break
    case 'Clawless':
      enemy.hp -= enemy.maxHp * 0.15
      break
    case 'Cerberus':
      enemy.damage *= 0.7
      break
    case 'Infectious':
      enemy.damage *= enemy.boss ? 0.85 : 0.5
      enemy.hp *= enemy.boss ? 0.85 : 0.5
      break
    case 'Dragon Slayer':
      card.damage *= 1.75
      break
    case 'Greater Might':
      boostStats(card, 1.4)
      break
    case 'Heavenly Might':
      boostStats(card, 1.65)
      break
    case 'Combatant':
      boostStats(card, 1.2)
      break
    case 'Sacrifice':
      card.damage *= 2
      card.hp /= 2
      break
    case 'Super Strength':
      card.damage *= 1.25
      card.maxHp *= 1.25
      card.hp = card.maxHp
      break
    case 'Immortal':
      // Typhon was nerfed from +250% HP to +200% HP: 3x total HP.
      card.maxHp *= 3
      card.hp *= 3
      break
    case 'Fury of the White Tiger':
      card.damage *= 3
      break
    case 'Tyrannospirit': {
      const fossils = runtime.state.boosts[card.team].fossils || 0
      if (fossils > 0) card.damage *= Math.pow(1.5, fossils)
      break
    }
    case 'Turtle Shell':
      card.maxHp = 30_000
      card.hp = 30_000
      break
    case 'Happy Family': {
      const dads = runtime.state.teams[card.team].filter((ally) => ally !== card && ally.definition.name === 'Dad' && alive(ally))
      for (const dad of dads) {
        dad.damage += card.damage
        dad.maxHp += card.maxHp
        dad.hp += Math.max(0, card.hp)
      }
      card.hp = 0
      resolveDeaths(runtime)
      break
    }
    case 'Pop-Up Impression':
      if (!statusProtected(runtime, enemy.team)) {
        const turns = card.flags.awakened ? (card.counters.toyCount || 1) : 2
        enemy.status.confused = Math.max(enemy.status.confused, turns)
      }
      break
    case 'Naughty List':
      for (const ally of runtime.state.teams[card.team]) {
        if (!alive(ally)) continue
        boostStats(ally, 1.5)
        ally.flags.naughtyListDrain = true
      }
      break
    case 'Toil':
      boostStats(card, 2)
      break
    case 'Bloodlust':
      card.counters.bloodlustBase = card.damage
      card.damage += card.damage
      card.flags.bloodlustFirstTurn = true
      break
    case 'Fluffy Aggression':
      if (card.flags.awakened) {
        const fallenToys = new Set(
          runtime.state.fallen[card.team]
            .filter((fallen) => TOY_CARD_NAMES.has(fallen.definition.name))
            .map((fallen) => fallen.definition.name),
        ).size
        card.damage *= toyBearAwakenedMultiplier(card, fallenToys)
      } else card.damage *= 2
      break
    case 'Speedy Progression':
      card.counters.attacks = (card.counters.attacks || 0) + (card.flags.awakened ? (card.counters.toyCount || 1) : 3)
      break
    case 'Red-Nosed Reindeer':
      if (!statusProtected(runtime, enemy.team)) enemy.status.blind = true
      break
    case 'Behavioral Therapy':
      enemy.flags.slowed = true
      enemy.counters.slowed = 0
      break
    case 'Stampede':
      card.counters.attacks = (card.counters.attacks || 0) + 1
      enemy.status.stunned = Math.max(1, enemy.status.stunned)
      break
    case 'Ice Age':
      enemy.flags.slowed = true
      enemy.counters.slowed = 0
      break
    case "Hell's Curse":
      enemy.flags.sealed = true
      enemy.hp /= 2
      pushAbilityDebug(runtime, card, `Hell's Curse sealed ${effectiveCardName(enemy) || enemy.definition.name} and cut its current HP in half.`)
      break
    case 'Northern Winds': {
      dealDamage(runtime, card, enemy)
      card.damage += enemy.damage * 0.25
      enemy.damage *= 0.75
      resolveDeaths(runtime)
      if (alive(enemy) && hasAbility(runtime, enemy, 'Hatred') && alive(card)) {
        dealDamage(runtime, enemy, card, 0.5)
        resolveDeaths(runtime)
      }
      break
    }
    case 'Azure Dragon Wrath':
      dealDamage(runtime, card, enemy, 1.5, true)
      resolveDeaths(runtime)
      if (alive(enemy) && hasAbility(runtime, enemy, 'Hatred') && alive(card)) {
        dealDamage(runtime, enemy, card, 0.5)
        resolveDeaths(runtime)
      }
      break
    case 'Revenge':
      if (runtime.state.fallen[card.team].length > 0) {
        dealDamage(runtime, card, enemy, 2)
        resolveDeaths(runtime)
      }
      break
    case 'Stolen Spotlight': {
      const deck = runtime.state.teams[card.team]
      const behind = deck[1]
      if (behind && behind !== card) {
        card.damage += behind.damage
        card.maxHp += behind.maxHp
        card.hp += Math.max(0, behind.hp)
        deck.splice(1, 1)
        behind.dead = true
      }
      break
    }
    case 'A Pair of Two':
      if (!card.flags.paired) {
        card.flags.paired = true
        const deck = runtime.state.teams[card.team]
        deck.push(cloneAtFraction(card, 0.35, deck.length + 1))
        deck.push(cloneAtFraction(card, 0.35, deck.length + 1))
      }
      break
    case 'Terror From Above': {
      const deck = runtime.state.teams[enemyTeam]
      for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(runtime.rng.next() * (i + 1))
        ;[deck[i], deck[j]] = [deck[j], deck[i]]
      }
      break
    }
    case 'Sudden Demise': {
      const hits = 1 + Math.floor(runtime.rng.next() * 8)
      const hitDamage = card.damage * 0.1
      for (let hit = 0; hit < hits; hit++) {
        for (const target of runtime.state.teams[enemyTeam]) target.hp -= Math.min(target.hp, hitDamage)
      }
      resolveDeaths(runtime)
      break
    }
    case 'Cosmic Rivalry':
      performEntryAttack(runtime, card, 3)
      break
    case 'Kitchen': {
      card.flags.kitchenDomain = true
      const hits = 2 + Math.floor(runtime.rng.next() * 4)
      for (let hit = 0; hit < hits; hit++) {
        const target = active(runtime, enemyTeam)
        if (!target || !alive(card)) break
        dealDamage(runtime, card, target, 0.35, true)
        resolveDeaths(runtime)
      }
      break
    }
    case 'War Scythe': {
      if (card.flags.warScytheEntryUsed) break
      card.flags.warScytheEntryUsed = true
      const targets = runtime.state.teams[enemyTeam].filter(alive).slice(0, 2)
      card.flags.warScytheEntry = true
      for (const target of targets) {
        if (!alive(card) || !alive(target)) continue
        target.flags.suppressOnDeath = true
        dealDamage(runtime, card, target, 1, true)
        if (target.hp > 0) target.flags.suppressOnDeath = false
        const deck = runtime.state.teams[target.team]
        const index = deck.indexOf(target)
        if (target.hp <= 0 && index > 0) {
          deck.splice(index, 1)
          target.dead = true
          target.hp = 0
          runtime.state.fallen[target.team].push(target)
        }
        resolveDeaths(runtime)
      }
      card.flags.warScytheEntry = false
      break
    }
    case 'First Blood':
      performEntryAttack(runtime, card, 0.5)
      break
    case 'Deadly Ambush': {
      const first = active(runtime, enemyTeam)
      if (first) {
        // Poison belongs to the card hit by the entry attack; do not jump it to the next
        // enemy if the entry hit kills its original target.
        dealDamage(runtime, card, first)
        if (alive(first) && !statusProtected(runtime, first.team)) first.counters.poisonPercent = -0.15
        resolveDeaths(runtime)
      }
      break
    }
    case 'Horned Attack': {
      const first = active(runtime, enemyTeam)
      if (first) {
        const hpBefore = first.hp
        const dealt = dealDamage(runtime, card, first)
        resolveDeaths(runtime)
        if (dealt > hpBefore && first.hp <= 0) {
          const next = active(runtime, enemyTeam)
          if (next) {
            const overflowDamage = Math.min(next.hp, dealt - hpBefore)
            // Preserve the live-game Triceratops quirk: lethal overkill into a
            // Parallax behind the front card bypasses Paradox retaliation.
            if (overflowDamage >= next.hp && hasAbility(runtime, next, 'Paradox') && !next.flags.paradox) {
              next.flags.paradox = true
              pushAbilityDebug(runtime, card, 'Horned Attack overkill bypassed Paradox on the card behind the defeated target.')
            }
            next.hp -= overflowDamage
          }
          resolveDeaths(runtime)
        }
      }
      break
    }
    case 'Fight Dirty':
    case 'Quick Strike':
    case 'Heart Hunter':
      performEntryAttack(runtime, card, 1)
      if (name === 'Heart Hunter' && active(runtime, enemyTeam)) active(runtime, enemyTeam)!.counters.bleed = 100
      break
    case 'Sacred Judgment': {
      const targets = [...runtime.state.teams[enemyTeam]]
      for (const target of targets) {
        if (!alive(card) || !alive(target)) continue
        dealDamage(runtime, card, target)
        resolveDeaths(runtime)
      }
      break
    }
    case 'Stardust Driver':
      performEntryAttack(runtime, card, 2.5)
      break
  }
  if (entryTraceBefore && name !== "Hell's Curse" && name !== 'Order of the Cosmos') {
    const cardName = effectiveCardName(card) || card.definition.name
    const alreadyLogged = runtime.debug.events.slice(entryTraceEventStart).some((event) => event.type === 'ability' && event.card === cardName)
    if (!alreadyLogged) {
      const changes = describeAbilityTrace(runtime, entryTraceBefore, card)
      if (changes.length) pushAbilityDebug(runtime, card, name + ': ' + changes.join('; ') + '.')
    }
  }
}

function offensive(runtime: Runtime, attacker: CombatCard, target: CombatCard, initial: number): { damage: number; bypass: boolean; special: boolean } {
  if (activeBonusAbilities(attacker).length) {
    let result = { damage: initial, bypass: false, special: false }
    for (const gained of activeBonusAbilities(attacker)) {
      const next = withAbility(attacker, gained, () => offensive(runtime, attacker, target, result.damage))
      result = { damage: next.damage, bypass: result.bypass || next.bypass, special: result.special || next.special }
    }
    return result
  }

  const name = resolvedAbility(runtime, attacker)
  let damage = initial
  let bypass = false
  if (!name || !hasAbility(runtime, attacker, name)) return { damage, bypass, special: false }
  let special = false
  const offensiveDebugBefore = runtime.captureDebug ? {
    attackerHp: attacker.hp, attackerMaxHp: attacker.maxHp, attackerDamage: attacker.damage,
    targetBleed: target.counters.bleed || 0, targetPoisonPercent: target.counters.poisonPercent || 0,
    targetFrostbite: target.counters.frostbite || 0, targetWeakness: target.status.weakness,
  } : null

  if ([
    'True Strike','Maelstrom','Judgment','Armageddon','Draconic Heart','Explosion','Telekinesis',
    'Favorable Odds','Vainglory','Modesty','Decapitate','Martial Will','Dominate','Decimate',
    'Prehistoric Wrath','Big and Large','Blade','Defraud','Assassinate','Sky Drop','Shadow Predator',
    'Apex Predator','Infinite Dagger Works','Extinction','God of Thunder','Fire World','Moonlight Beam',
    'Dirty Claw','Heart Hunter','Chainsaw','Firepower','Rapid Blows','Behavioral Therapy',
    'Holy Wrath','Unlucky','Dragon Slayer','Frozen Wrath','Absolute Apex',
    'Dark Qi Manipulation','Chaos Destruction','ConstellarTaurus','ConstellarSagittarius','Whooping',
    'Twelve Devas Axe','Staff of Perfect Enlightenment','Kitchen','War Scythe',
  ].includes(name)) special = true

  switch (name) {
    case 'Twelve Devas Axe': damage *= 2.5; break
    case 'Staff of Perfect Enlightenment':
      damage *= 1.25
      bypass = true
      if (!statusProtected(runtime, target.team) && rand(runtime, attacker.team) < 0.25) target.status.stunned = Math.max(1, target.status.stunned)
      break
    case 'Kitchen': bypass = true; break
    case 'War Scythe': if (attacker.flags.warScytheEntry) bypass = true; break
    case 'True Strike': if (rand(runtime, attacker.team) > 0.5) damage *= 2; break
    case 'Absolute Apex': damage *= 1.5; break
    case 'Whooping': if (cardAge(attacker.definition.name) > cardAge(target.definition.name)) damage *= 2; break
    case 'ConstellarTaurus': damage *= constellarTaurusFactor(attacker); break
    case 'Chaos Destruction': if (attacker.flags.chaosTriple) { damage *= 3; attacker.flags.chaosTriple = false }; break
    case 'Dark Qi Manipulation': if (attacker.flags.awakened) damage *= 2; break
    case "Monkey King's Rage":
      if (attacker.hp / attacker.maxHp <= 0.5 && !attacker.flags.transformed) {
        attacker.flags.transformed = true
        attacker.maxHp *= 2
        attacker.hp *= 2
        damage *= 2
      }
      break
    case "Reaper's Luck": {
      const changes = [-0.1, 0.15, 0.3]
      const roll = rand(runtime, attacker.team)
      const change = changes[Math.max(0, Math.min(2, Math.ceil(roll * 3) - 1))]
      const ratio = attacker.maxHp > 0 ? attacker.hp / attacker.maxHp : 0
      attacker.maxHp *= 1 + change
      attacker.hp = ratio * attacker.maxHp
      attacker.damage *= 1 + change
      break
    }
    case 'Holy Wrath': if (UNDEAD_CARDS.has(target.definition.name)) damage *= 2; break
    case 'Unlucky': if (target.definition.ability && RNG_ABILITIES.has(target.definition.ability)) damage *= 2; break
    case 'Maelstrom':
      attacker.counters.maelstrom = (attacker.counters.maelstrom || 0) % 2 + 1
      if (attacker.counters.maelstrom === 1) damage *= 2
      break
    case 'Judgment': damage += (attacker.maxHp - attacker.hp) * 0.7; break
    case 'Armageddon': {
      const success = rand(runtime, attacker.team) > 0.5
      if (success) damage = Number.POSITIVE_INFINITY
      pushAbilityDebug(runtime, attacker, `Armageddon ${success ? 'succeeded — this hit became lethal' : 'failed — normal attack damage only'}.`)
      break
    }
    case 'Draconic Heart':
      damage *= 3
      attacker.damage *= 0.9
      attacker.hp *= 0.9
      attacker.maxHp *= 0.9
      break
    case 'Explosion': damage *= 3; attacker.status.stunned = Math.max(1, attacker.status.stunned); break
    case 'Telekinesis':
      attacker.counters.telekinesis = (attacker.counters.telekinesis || 0) % 2 + 1
      damage *= attacker.counters.telekinesis === 1 ? 2 : 4
      break
    case 'Dragon Slayer': if (DRAGON_CARDS.has(target.definition.name)) damage *= 2; break
    case 'Frozen Wrath': if (!statusProtected(runtime, target.team)) target.counters.frostbite = Math.max(target.counters.frostbite || 0, 2); break
    case 'Favorable Odds': damage *= Math.max(1, Math.ceil(rand(runtime, attacker.team) * 5)); break
    case 'Vainglory': if (attacker.hp / attacker.maxHp > 0.5) damage *= 1.5; break
    case 'Frail': damage *= 1.5; break
    case 'Modesty': damage *= 0.7; break
    case 'Decapitate': damage *= 2; break
    case 'Martial Will': {
      const ah = attacker.counters.martialHits || 0
      const th = target.counters.martialHits || 0
      if (ah > 0 && th > 0) damage *= Math.pow(1.5, ah)
      else if (ah === 0 && th > 0) target.counters.martialHits = 0
      attacker.counters.martialHits = ah + 1
      target.counters.martialHits = (target.counters.martialHits || 0) + 1
      break
    }
    case 'Decimate': damage *= 3; attacker.damage *= 0.7; break
    case 'Prehistoric Wrath': if (target.hp / target.maxHp <= 0.5) damage *= 2; break
    case 'Big and Large': if (attacker.hp / attacker.maxHp > 0.25) damage *= 3; break
    case 'Blade':
      damage += attacker.maxHp * 0.15
      attacker.maxHp *= 0.85
      attacker.hp = Math.min(attacker.hp, attacker.maxHp)
      break
    case 'Defraud': damage = target.hp * 0.5; break
    case 'Assassinate': if (target.hp / target.maxHp <= 0.25) damage = target.maxHp; break
    case 'Sky Drop': damage *= 1.5; break
    case 'Shadow Predator':
      if (attacker.flags.double) { damage *= 2; attacker.flags.double = false }
      break
    case 'Apex Predator': damage *= 1.5; break
    case 'Infinite Dagger Works': damage *= 2; break
    case 'Extinction': damage *= 10; attacker.hp = 0; break
    case 'God of Thunder':
      attacker.counters.thunder = (attacker.counters.thunder || 0) % 2 + 1
      if (attacker.counters.thunder === 1) damage *= 2.5
      bypass = true
      break
    case 'Fire World':
      attacker.counters.fireWorld = (attacker.counters.fireWorld || 0) % 2 + 1
      if (attacker.counters.fireWorld === 1) damage *= 4
      break
    case 'Moonlight Beam':
      if (!attacker.flags.moonlightUsed) { attacker.flags.moonlightUsed = true; damage *= 5 }
      break
    case 'Dirty Claw':
      target.counters.poisonPercent = -0.15
      target.status.weakness = true
      target.counters.weaknessTurns = 100
      break
    case 'Undead Practitioner': target.counters.bleed = 100; break
    case 'Heart Hunter': if ((target.counters.bleed || 0) > 0) damage *= 3; break
    case 'Chainsaw': damage *= 0.5; break
    case 'Firepower': damage *= 0.25; break
    case 'Rapid Blows': damage *= 0.5; break
    case 'Speedy Progression': damage /= 3; break
    case 'Behavioral Therapy': target.counters.bleed = (target.counters.bleed || 0) + 1; break
  }

  if (name === 'Dominate' && borderTier(attacker) > borderTier(target)) damage *= 2
  if (name === 'Lightning Slash') { damage *= 1.5; bypass = true }
  if (name === 'Limitless' || name === 'True Fang') bypass = true
  if (offensiveDebugBefore && name !== 'Armageddon') {
    const changes: string[] = []
    const n = (value: number) => Number.isFinite(value) ? String(Math.round(value)) : 'lethal'
    const changed = (before: number, after: number) => Math.abs(before - after) > Math.max(0.001, Math.abs(before) * 1e-9)
    if (changed(initial, damage)) changes.push('attack damage ' + n(initial) + ' → ' + n(damage))
    if (bypass) changes.push('bypasses defense')
    if (changed(offensiveDebugBefore.attackerDamage, attacker.damage)) changes.push('own ATK ' + n(offensiveDebugBefore.attackerDamage) + ' → ' + n(attacker.damage))
    if (changed(offensiveDebugBefore.attackerMaxHp, attacker.maxHp)) changes.push('own max HP ' + n(offensiveDebugBefore.attackerMaxHp) + ' → ' + n(attacker.maxHp))
    if (changed(offensiveDebugBefore.attackerHp, attacker.hp)) changes.push('own HP ' + n(offensiveDebugBefore.attackerHp) + ' → ' + n(attacker.hp))
    if (offensiveDebugBefore.targetBleed !== (target.counters.bleed || 0)) changes.push('applied/changed bleed')
    if (offensiveDebugBefore.targetPoisonPercent !== (target.counters.poisonPercent || 0)) changes.push('applied/changed poison')
    if (offensiveDebugBefore.targetFrostbite !== (target.counters.frostbite || 0)) changes.push('applied/changed frostbite')
    if (offensiveDebugBefore.targetWeakness !== target.status.weakness) changes.push(target.status.weakness ? 'applied weakness' : 'removed weakness')
    if (changes.length) pushAbilityDebug(runtime, attacker, name + ': ' + changes.join('; ') + '.')
  }
  return { damage, bypass, special }
}

function defensive(runtime: Runtime, attacker: CombatCard, target: CombatCard, initial: number): number {
  if (activeBonusAbilities(target).length) {
    let damage = initial
    for (const gained of activeBonusAbilities(target)) {
      damage = withAbility(target, gained, () => defensive(runtime, attacker, target, damage))
    }
    return damage
  }

  const name = resolvedAbility(runtime, target)
  let damage = initial
  if (!name || !hasAbility(runtime, target, name)) return damage
  const defensiveDebugBefore = runtime.captureDebug ? { attackerHp: attacker.hp, attackerDamage: attacker.damage, targetHp: target.hp, targetDamage: target.damage } : null

  switch (name) {
    case 'ConstellarTaurus': damage /= constellarTaurusFactor(target); break
    case 'ConstellarCancer': {
      const threshold = target.counters.cancerThreshold || 1
      if (threshold > 0 && damage < target.maxHp * threshold) {
        damage = 0
        target.counters.cancerThreshold = Math.max(0, threshold - 0.15)
      }
      break
    }
    case 'Danger Sense':
    case 'Deadly Ambush':
      if (!target.flags.dangerSense && damage > target.hp) {
        target.flags.dangerSense = true
        damage = 0
        const deck = runtime.state.teams[target.team]
        const index = deck.indexOf(target)
        if (index >= 0 && deck[index + 1]) {
          deck[index] = deck[index + 1]
          deck[index + 1] = target
        }
      }
      break
    case 'Evasion': if (rand(runtime, target.team) > 0.9) damage = 0; break
    case 'Divine Ascension': if (rand(runtime, target.team) > Math.pow(damage / target.maxHp, 2)) damage = 0; break
    case 'Mastered Ascension':
      target.counters.masteredAscension = ((target.counters.masteredAscension || 0) + 1) % 2
      if (target.counters.masteredAscension === 1) damage = 0
      break
    case 'Vajra Short Sword':
      if (rand(runtime, target.team) < 0.4) {
        const reflected = Math.min(Math.max(0, attacker.hp * 0.75), Math.max(0, damage * 0.75))
        damage = 0
        attacker.hp -= reflected
      }
      break
    case 'Shield of Ahimsa': damage *= 0.65; break
    case 'Cosmic Rivalry': damage *= Math.max(0, 1 - Math.min(1, target.counters.cosmicRivalryDR || 0)); break
    case 'Finesse': if (damage < target.maxHp * 0.3) damage = 0; break
    case 'Last Stand':
      if (damage >= target.hp && !target.flags.lastStand) { damage = target.hp - 1; target.flags.lastStand = true }
      break
    case 'Armor': damage = Math.max(0, damage - target.maxHp * 0.1); break
    case 'Dragon Slayer': if (DRAGON_CARDS.has(attacker.definition.name)) damage *= 0.5; break
    case 'Outrank':
      if (rarityWithBorders(attacker.definition, attacker.borders) < rarityWithBorders(target.definition, target.borders)) damage *= 0.5
      break
    case 'Golden Bell Shield': if (DEMON_CARDS.has(attacker.definition.name) || IMP_BOOSTED_CARDS.has(attacker.definition.name)) damage /= 3; break
    case 'Frozen Wrath': if ((attacker.counters.frostbite || 0) > 0) damage *= 0.5; break
    case 'Brittle': damage *= 2; break
    case 'Mana Shield':
      if (!target.flags.manaShield && damage < target.hp) { damage = 0; target.flags.manaShield = true }
      break
    case 'Vainglory': if (target.hp / target.maxHp > 0.5) damage *= 0.7; break
    case 'Modesty': damage *= 1.3; break
    case 'Scale Armor': damage = Math.max(0, damage - target.maxHp * 0.15) / 2; break
    case 'Stalwart': if (damage > target.maxHp / 3 && target.hp > target.maxHp / 3) damage = target.maxHp / 3; break
    case 'Divine Barrier':
      if (!target.flags.divineBarrier) { damage = 0; target.flags.divineBarrier = true }
      break
    case 'Untouchable': if (rand(runtime, target.team) > Math.pow(damage / target.maxHp, 2)) damage = 0; break
    case 'Guerilla Warfare':
      if (rand(runtime, target.team) > 0.6) { damage = 0; target.damage *= 1.2 }
      break
    case 'The Loser':
      if (!target.flags.loser && damage > target.hp) { damage = 0; target.flags.loser = true; target.damage *= 2 }
      break
    case 'Invisibility': if (rand(runtime, target.team) > 0.4) damage = 0; break
    case 'Limitless':
      if (!target.flags.limitless) {
        damage = 0
        target.flags.limitless = true
        pushAbilityDebug(runtime, target, `Limitless evaded the first attack from ${effectiveCardName(attacker) || attacker.definition.name}.`)
      }
      break
    case 'Heavenly Ruler':
      target.counters.heavenly = ((target.counters.heavenly || 0) + 1) % 2
      if (target.counters.heavenly === 0) damage *= -0.8
      break
    case 'Absolute Sovereignty': damage *= 0.65; break
    case 'Draconic Heart': damage /= 3; break
    case 'Invincibility': damage *= 0.25; break
    case 'Hidden Curse': {
      const maxes = target.counters.hiddenCurse || 0
      const afflicted = attacker.status.weakness || attacker.status.burn > 0 || attacker.status.confused > 0 || attacker.status.stunned > 0 || attacker.status.blind || (attacker.counters.bleed || 0) > 0 || Boolean(attacker.counters.poisonFlat || attacker.counters.poisonPercent)
      if (maxes <= 5 && afflicted) { damage = 0; target.counters.hiddenCurse = maxes + 1 }
      break
    }
    case 'Transcend Time':
      target.counters.transcend = ((target.counters.transcend || 0) + 1) % 2
      if (target.counters.transcend === 1) damage = 0
      break
    case 'Snowbound': if (target.status.stunned > 0 || target.flags.dodge) { damage = 0; target.flags.dodge = false }; break
    case 'Shelter Obsession': {
      const cap = target.flags.awakened ? target.maxHp / 4 : target.maxHp / 2
      if (damage > cap && target.hp > cap) damage = cap
      break
    }
    case 'Big and Large': if (target.hp / target.maxHp > 0.25) damage *= 0.5; break
    case 'Frail': damage *= 1.5; break
    case "Humanity's Spirit": if (target.hp / target.maxHp < 0.25) damage *= 0.5; break
    case 'Perforating Mist': damage *= 1.5; break
    case 'Reflective Shell': {
      const abilityDamage = damage - attacker.damage
      if (abilityDamage > 0) {
        const reflected = Math.min(target.damage * 8, abilityDamage * 0.25)
        damage -= reflected
        attacker.hp -= reflected
      }
      break
    }
    case 'Sky Drop':
      if (!target.counters.drop || target.counters.drop % 2 !== 0) damage = 0
      break
    case 'Spikes': damage *= 0.75; attacker.counters.bleed = 2; break
    case 'Shadow Predator':
      if (rand(runtime, target.team) > 0.6) { damage = 0; target.flags.double = true }
      break
    case 'Apex Predator': damage *= 0.5; break
    case 'Absolute Apex': damage *= 0.5; break
    case 'Immortal Ascension': if (target.flags.awakened) damage *= 0.5; break
    case 'Final Tail': damage = 0; break
    case 'Persistent': {
      const persistence = target.counters.persistence || 0
      if (damage >= target.hp && persistence < 2) {
        damage = target.hp - 1
        target.counters.persistence = persistence + 1
      }
      break
    }
    case 'Run As Fast As You Can':
      target.counters.runFast = ((target.counters.runFast || 0) + 1) % 2
      if (target.counters.runFast === 0) {
        damage = 0
        target.counters.attacks = (target.counters.attacks || 0) + 1
      }
      break
    case 'Bind': attacker.damage *= 0.9; break
    case 'Avalon': if (damage < target.damage * 0.75) damage = 0; break
    case 'Heard but not Seen': {
      const dodge = Math.min(0.5, 0.2 + (target.counters.heardHits || 0) * 0.1)
      if (rand(runtime, target.team) < dodge) damage = 0
      else target.counters.heardHits = (target.counters.heardHits || 0) + 1
      break
    }
    case 'Lights Way':
      if (!target.flags.lightsWay && damage >= target.hp) {
        target.flags.lightsWay = true
        damage = 0
        target.hp = Math.min(target.maxHp, target.hp + target.maxHp * 0.5)
      }
      break
  }

  if (name === 'Dominate' && borderTier(target) > borderTier(attacker)) damage /= 2
  if (initial > 0 && damage === 0 && DODGE_ABILITIES.has(name)) target.flags.evadedThisHit = true
  if (defensiveDebugBefore && name !== 'Limitless') {
    const changes: string[] = []
    const n = (value: number) => Number.isFinite(value) ? String(Math.round(value)) : 'lethal'
    const changed = (before: number, after: number) => Math.abs(before - after) > Math.max(0.001, Math.abs(before) * 1e-9)
    if (changed(initial, damage)) changes.push(damage === 0 ? 'blocked ' + n(initial) + ' incoming damage' : 'incoming damage ' + n(initial) + ' → ' + n(damage))
    if (changed(defensiveDebugBefore.attackerHp, attacker.hp)) changes.push('attacker HP ' + n(defensiveDebugBefore.attackerHp) + ' → ' + n(attacker.hp))
    if (changed(defensiveDebugBefore.attackerDamage, attacker.damage)) changes.push('attacker ATK ' + n(defensiveDebugBefore.attackerDamage) + ' → ' + n(attacker.damage))
    if (changed(defensiveDebugBefore.targetHp, target.hp)) changes.push('own HP ' + n(defensiveDebugBefore.targetHp) + ' → ' + n(target.hp))
    if (changed(defensiveDebugBefore.targetDamage, target.damage)) changes.push('own ATK ' + n(defensiveDebugBefore.targetDamage) + ' → ' + n(target.damage))
    if (changes.length) pushAbilityDebug(runtime, target, name + ': ' + changes.join('; ') + '.')
  }
  return damage
}

function tryRevive(runtime: Runtime, attacker: CombatCard, target: CombatCard): boolean {
  if (target.hp > 0 || attacker.flags.warScytheEntry) return false
  if (activeBonusAbilities(target).length) {
    for (const gained of activeBonusAbilities(target)) {
      const revived = withAbility(target, gained, () => tryRevive(runtime, attacker, target))
      if (revived) return true
    }
    return false
  }
  const name = resolvedAbility(runtime, target)
  // Revive-style abilities are still abilities. Respect Fuxi's Order of the Cosmos,
  // Hell's Curse/Eclipse seals, Honor, End Times, and any other ability-disable path.
  if (!name) return false
  if (!hasAbility(runtime, target, name)) {
    if (['Revive', 'Eternity', 'Frozen Ashes', "Unpaid 'Interns'", 'Flames of Rebirth'].includes(name)) {
      pushAbilityDebug(runtime, target, `${name} could not activate because the ability was blocked or disabled.`)
    }
    return false
  }
  if (name === 'Revive' && !target.flags.revived && rand(runtime, target.team) > 0.5) {
    target.flags.revived = true
    target.hp = target.maxHp * 0.5
    pushAbilityDebug(runtime, target, 'Revive succeeded — returned at 50% HP.')
    return true
  }
  if (name === 'Eternity' && !target.flags.revived && rand(runtime, target.team) > 0.5) {
    target.flags.revived = true
    target.hp = target.maxHp
    pushAbilityDebug(runtime, target, 'Eternity succeeded — returned at full HP.')
    return true
  }
  if (name === 'Frozen Ashes' && !target.flags.revived && rand(runtime, target.team) > 0.5) {
    target.flags.revived = true
    target.hp = target.maxHp
    attacker.status.stunned = Math.max(1, attacker.status.stunned)
    pushAbilityDebug(runtime, target, `Frozen Ashes revived at full HP and froze ${effectiveCardName(attacker) || attacker.definition.name}.`)
    return true
  }
  if (name === "Unpaid 'Interns'" && (target.counters.interns || 0) < 2) {
    target.counters.interns = (target.counters.interns || 0) + 1
    target.hp = target.maxHp
    pushAbilityDebug(runtime, target, `Unpaid Interns activated — extra life ${target.counters.interns}/2 used; returned at full HP.`)
    return true
  }
  if (name === 'Flames of Rebirth' && !target.flags.revived) {
    target.flags.revived = true
    target.hp = target.maxHp * 0.5
    target.damage *= 2
    attacker.status.burn = 2
    pushAbilityDebug(runtime, target, `Flames of Rebirth activated — returned at 50% HP with doubled ATK and burned ${effectiveCardName(attacker) || attacker.definition.name}.`)
    return true
  }
  return false
}

function targetRetroCore(runtime: Runtime, attacker: CombatCard, target: CombatCard, damage: number) {
  if (activeBonusAbilities(target).length) {
    for (const gained of activeBonusAbilities(target)) {
      withAbility(target, gained, () => targetRetro(runtime, attacker, target, damage))
    }
    return
  }
  const name = resolvedAbility(runtime, target)
  if (!name || !hasAbility(runtime, target, name)) return
  switch (name) {
    case 'Restoration': if (target.hp > 0) target.hp += damage * 0.7; break
    case 'Rage': if (target.hp > 0) target.damage *= 1.25; break
    case 'Undead': if (target.hp > 0) target.hp = Math.min(target.maxHp, target.hp + target.maxHp * 0.25); break
    case 'Passion':
      attacker.counters.passion = (attacker.counters.passion || 0) + 1
      if (attacker.counters.passion <= 3) attacker.damage *= 0.65
      break
    case 'Eight Heads': target.damage *= 0.875; target.hp *= 0.875; break
    case 'Wail':
      if (target.hp < target.maxHp / 2 && !target.flags.wail) { target.flags.wail = true; attacker.status.stunned = Math.max(1, attacker.status.stunned) }
      break
    case 'Fury of the White Tiger': target.damage = Math.max(0, target.damage - damage); break
    case 'The Fall': {
      const reflected = attacker.definition.name === 'Marrowclaw' ? Math.min(Math.max(0, attacker.hp - 1), damage) : Math.min(attacker.hp, damage)
      attacker.hp -= reflected
      break
    }
    case 'Self-Destruct':
    case 'Death Embrace':
      if (target.hp <= 0 && rand(runtime, target.team) > 0.5) {
        const reflected = attacker.definition.name === 'Marrowclaw' ? Math.min(Math.max(0, attacker.hp - 1), target.maxHp) : Math.min(attacker.hp, target.maxHp)
        attacker.hp -= reflected
      }
      break
    case 'Undead Practitioner':
      if (target.hp > 0 && !target.flags.undeadPractitioner && target.hp <= target.maxHp / 2) {
        target.hp += target.maxHp * 0.5; target.flags.undeadPractitioner = true
      }
      break
    case 'Guilt': if (target.hp <= 0) attacker.flags.hanged = true; break
    case 'Into The Sun': if (target.hp / target.maxHp < 0.33) { target.hp = 0; attacker.hp = 0 }; break
    case 'Frigid Touch': if (damage > 0 && rand(runtime, attacker.team) >= 0.5) target.status.stunned = Math.max(1, target.status.stunned); break
    case 'Blinding Flash': if (rand(runtime, attacker.team) > 0.7) attacker.flags.extraTurn = true; break
    case 'Grape Juice': {
      const reflected = attacker.definition.name === 'Marrowclaw' ? Math.min(Math.max(0, attacker.hp - 1), target.damage / 2) : Math.min(attacker.hp, target.damage / 2)
      attacker.hp -= reflected
      break
    }
    case 'Perfect Sacrifice':
      if (target.hp <= 0) {
        const reflected = attacker.definition.name === 'Marrowclaw' ? Math.min(Math.max(0, attacker.hp - 1), target.maxHp) : Math.min(attacker.hp, target.maxHp)
        attacker.hp -= reflected
        for (const ally of runtime.state.teams[target.team]) boostStats(ally, 1.2)
      }
      break
    case 'Plague':
      if (damage > 0 && attacker !== target && !statusProtected(runtime, attacker.team)) {
        attacker.counters.poisonFlat = Math.max(attacker.counters.poisonFlat || 0, target.damage)
        attacker.counters.poisonTurns = Math.max(attacker.counters.poisonTurns || 0, 2)
      }
      break
    case 'Steal Christmas':
      if (damage > 0 && attacker !== target && !target.flags.stealChristmasUsed) {
        // Steal Christmas activates only once per Grinch.
        target.flags.stealChristmasUsed = true
        const stolenHp = Math.max(0, attacker.hp * 0.2)
        const stolenDamage = Math.max(0, attacker.damage * 0.2)
        target.damage += stolenDamage
        target.hp += stolenHp
        attacker.hp = Math.max(0, attacker.hp - stolenHp)
        attacker.damage = Math.max(0, attacker.damage - stolenDamage)
      }
      break
    case 'Shelter Obsession':
      if (damage > 0 && target.flags.awakened) {
        const seen = new Set<string>()
        const toyDeck = [...runtime.state.teams[target.team], ...runtime.state.fallen[target.team]]
        for (const toy of toyDeck) {
          if (!TOY_CARD_NAMES.has(toy.definition.name) || seen.has(toy.definition.name)) continue
          seen.add(toy.definition.name)
          boostStats(toy, 1.1)
        }
      }
      break
    case 'Poke the Beast':
      if (damage > 0 && !statusProtected(runtime, attacker.team)) attacker.status.burn = Math.max(attacker.status.burn, 2)
      break
    case 'Last Meal':
      if (damage > 0) {
        const fossils = runtime.state.boosts[target.team].fossils || 0
        attacker.counters.death = Math.max(2, 5 - fossils)
      }
      break
    case 'Boiling Blood': if (!statusProtected(runtime, attacker.team)) attacker.status.burn = 3; break
    case 'Melt': if (!statusProtected(runtime, attacker.team)) attacker.status.burn += 5; break
  }
}

function targetRetro(runtime: Runtime, attacker: CombatCard, target: CombatCard, damage: number) {
  const name = resolvedAbility(runtime, target)
  if (activeBonusAbilities(target).length) return targetRetroCore(runtime, attacker, target, damage)
  return runAbilityTrace(runtime, target, name, () => targetRetroCore(runtime, attacker, target, damage))
}

function vampireMatronCanHeal(card: CombatCard): boolean {
  const name = effectiveCardName(card) || card.definition.name
  return name !== 'Odin' && name !== 'Gilgamesh'
}

function lifestealFraction(runtime: Runtime, attacker: CombatCard, base: number): number {
  const vamp = runtime.state.boosts[attacker.team].vampireMatron
  return vamp && vampireMatronCanHeal(attacker) ? base * (100 + vamp * 5) / 100 : base
}

function attackerRetroCore(runtime: Runtime, attacker: CombatCard, target: CombatCard, damage: number): boolean {
  if (activeBonusAbilities(attacker).length) {
    let didRegen = false
    for (const gained of activeBonusAbilities(attacker)) {
      didRegen = withAbility(attacker, gained, () => attackerRetro(runtime, attacker, target, damage)) || didRegen
    }
    return didRegen
  }
  const name = resolvedAbility(runtime, attacker)
  let didRegen = false
  if (!name || !hasAbility(runtime, attacker, name)) return didRegen
  switch (name) {
    case 'ConstellarScorpio':
      if (damage > 0 && !statusProtected(runtime, target.team)) target.counters.poisonFlat = Math.max(target.counters.poisonFlat || 0, attacker.damage)
      break
    case 'Plague':
      if (damage > 0 && !statusProtected(runtime, target.team)) {
        target.counters.poisonFlat = Math.max(target.counters.poisonFlat || 0, attacker.damage)
        target.counters.poisonTurns = Math.max(target.counters.poisonTurns || 0, 2)
      }
      break
    case 'Undying':
      if (target.hp <= 0 && attacker.flags.undyingActive) attacker.counters.undyingTurns = (attacker.counters.undyingTurns || 0) + 1
      break
    case "Witch's Curse":
      if (damage > 0 && !attacker.flags.witchCurseStolen) {
        const stolen = ability(target)
        if (stolen && stolen !== "Witch's Curse") {
          attacker.flags.witchCurseStolen = true
          attacker.abilityOverride = stolen
        }
      }
      break
    case 'Flesh Eater':
      if (damage > 0) {
        const gain = damage * 0.25
        attacker.hp = Math.min(attacker.maxHp, attacker.hp + gain)
        attacker.damage += gain
      }
      break
    case 'Gobble':
      if (target.hp <= 0 && target !== attacker) {
        attacker.damage += target.damage * 0.5
        attacker.maxHp += target.maxHp * 0.5
        attacker.hp = Math.min(attacker.maxHp, attacker.hp + target.maxHp * 0.5 + attacker.maxHp * 0.3)
      }
      break
    case 'Playing God':
      if (target.hp <= 0 && target !== attacker) {
        const frankenstein = definition('Frankenstein')
        if (frankenstein) {
          const created: CombatCard = {
            ...attacker,
            id: `${attacker.team}:frankenstein:${runtime.state.turn}:${runtime.state.teams[attacker.team].length}`,
            definition: frankenstein,
            index: runtime.state.teams[attacker.team].length + 1,
            hp: attacker.maxHp,
            maxHp: attacker.maxHp,
            damage: attacker.damage,
            entered: false,
            dead: false,
            identityOverride: undefined,
            abilityOverride: undefined,
            bonusAbilities: undefined,
            status: { stunned: 0, confused: 0, burn: 0, weakness: false, blind: false, shield: 0 },
            flags: {},
            counters: { normalDamage: attacker.damage, normalMaxHp: attacker.maxHp },
          }
          runtime.state.teams[attacker.team].push(created)
        }
      }
      break
    case 'Forbidden Banquet':
      if (target.hp <= 0 && !attacker.flags.banquetStolen) {
        const stolen = ability(target)
        if (stolen && stolen !== 'Forbidden Banquet') {
          attacker.flags.banquetStolen = true
          attacker.abilityOverride = stolen
        }
      }
      break
    case 'Regenerate': attacker.hp = Math.min(attacker.maxHp, attacker.hp + attacker.maxHp * 0.2); didRegen = true; break
    case 'Plunder':
      if (target.hp <= 0 && target !== attacker) {
        attacker.damage += target.damage * 0.3; attacker.maxHp += target.maxHp * 0.3; attacker.hp += target.maxHp * 0.3
      }
      break
    case 'Voracity': if (target.hp <= 0) { attacker.damage *= 1.2; attacker.hp = Math.min(attacker.maxHp, attacker.hp + attacker.maxHp * 0.2) }; break
    case 'Blood Drinker':
    case 'Lifesteal': {
      const heal = damage * lifestealFraction(runtime, attacker, 0.5)
      attacker.hp = Math.min(attacker.maxHp, attacker.hp + heal); didRegen = true; break
    }
    case 'Drain Vitality': {
      attacker.hp = Math.min(attacker.maxHp, attacker.hp + damage * lifestealFraction(runtime, attacker, 1)); didRegen = true
      const stolen = Math.min(target.damage, damage); attacker.damage += stolen; target.damage -= stolen; break
    }
    case 'Unholy Creature': if (!statusProtected(runtime, target.team)) target.counters.poisonPercent = -0.15; break
    case 'Insatiable': {
      // Insatiable only chains after an actual defeat. Reaching 0 HP is not a
      // defeat while a lethal-prevention ability is still keeping the card alive.
      // Without this guard, Wendigo can repeatedly "kill" an Unholy Creature at
      // 1 HP inside the same turn, so the global Unholy timer never advances.
      const unholySurvives = hasAbility(runtime, target, 'Unholy Creature')
        && (!target.flags.unholyActive || (target.counters.unholyTurns || 0) > 0)
      const undyingSurvives = hasAbility(runtime, target, 'Undying')
        && (!target.flags.undyingActive || (target.counters.undyingTurns || 0) > 0)
      const paradoxSurvives = hasAbility(runtime, target, 'Paradox') && !target.flags.paradox
      if (target.hp <= 0 && target !== attacker && !unholySurvives && !undyingSurvives && !paradoxSurvives) {
        attacker.damage += target.damage * 0.3
        attacker.maxHp += target.maxHp * 0.3
        attacker.hp += target.maxHp * 0.3
        attacker.flags.insatiableAttack = true
      }
      break
    }
    case 'Devilish':
      if (target.hp <= 0 && target !== attacker) {
        const converted: CombatCard = {
          ...target,
          id: `${attacker.team}:devilish:${runtime.state.turn}:${target.definition.name}`,
          team: attacker.team,
          index: runtime.state.teams[attacker.team].length + 1,
          hp: target.maxHp,
          entered: false,
          dead: false,
          status: { stunned: 0, confused: 0, burn: 0, weakness: false, blind: false, shield: 0 },
          flags: {},
          counters: { normalDamage: target.damage },
        }
        runtime.state.teams[attacker.team].push(converted)
      }
      break
    case 'Eclipse':
      if (damage > 0) {
        const wasSealed = target.flags.sealed
        target.flags.sealed = true
        if (!wasSealed) pushAbilityDebug(runtime, attacker, `Eclipse disabled ${effectiveCardName(target) || target.definition.name}'s ability after dealing damage.`)
      }
      break
    case 'Dark Qi Manipulation':
      if (attacker.flags.awakened) {
        attacker.hp = Math.min(attacker.maxHp, attacker.hp + damage * 0.3)
        didRegen = true
        if (target.hp <= 0) boostStats(attacker, 1.5)
      }
      break
    case 'Immortal Ascension': if (attacker.flags.awakened && target.hp <= 0) boostStats(attacker, 1.5); break
    case 'Doom': if (!hasAbility(runtime, target, 'Erosion') && target.hp > 0 && rand(runtime, attacker.team) > 1 - damage / target.hp) { target.hp = 0; target.flags.sealed = true }; break
    case 'Decapitate': {
      const unholySurvives = hasAbility(runtime, target, 'Unholy Creature')
        && (!target.flags.unholyActive || (target.counters.unholyTurns || 0) > 0)
      if (target.hp <= 0 && !unholySurvives) {
        boostStats(attacker, 1.2)
        attacker.flags.extraTurn = true
      }
      break
    }
    case 'Fury of the White Tiger': if (target.hp <= 0) { attacker.damage *= 1.35; attacker.hp = Math.min(attacker.maxHp, attacker.hp + attacker.maxHp * 0.35) }; break
    case 'Feeder': if (target.hp <= 0) attacker.hp = attacker.maxHp; break
    case 'Defraud': attacker.hp -= attacker.maxHp / 4; break
    case 'Fight Dirty': target.damage = Math.floor(target.damage * 0.7); break
    case 'Unforgiving': target.maxHp = Math.max(1, target.maxHp - damage); target.hp = Math.min(target.hp, target.maxHp); break
    case 'Eat The Moon': if (!hasAbility(runtime, target, 'Erosion') && target.hp / target.maxHp < 0.33) target.hp = 0; break
    case 'Death Embrace': if (!hasAbility(runtime, target, 'Erosion') && target.hp > 0 && rand(runtime, attacker.team) > 1 - damage / target.hp) target.hp = 0; break
    case 'Prehistoric Wrath': if (target.hp <= 0) attacker.damage *= 2; break
  }
  return didRegen
}

function attackerRetro(runtime: Runtime, attacker: CombatCard, target: CombatCard, damage: number): boolean {
  const name = resolvedAbility(runtime, attacker)
  if (activeBonusAbilities(attacker).length) return attackerRetroCore(runtime, attacker, target, damage)
  return runAbilityTrace(runtime, attacker, name, () => attackerRetroCore(runtime, attacker, target, damage))
}

function resolveAuraFarm(runtime: Runtime, target: CombatCard, incoming: number): { target: CombatCard; damage: number } {
  if (incoming < target.hp) return { target, damage: incoming }
  const deck = runtime.state.teams[target.team]
  // Aura Farm only protects the active card directly ahead of Piccolo.
  // Origin/Long Reach can hit Piccolo on the bench; Piccolo must never
  // treat itself as the card it is protecting or overwrite the front slot.
  if (deck[0] !== target) return { target, damage: incoming }
  const piccolo = deck[1]
  if (!piccolo || piccolo === target || !alive(piccolo) || piccolo.definition.name !== 'Piccolo' || piccolo.flags.farmed) return { target, damage: incoming }
  // Order of the Cosmos blocks Piccolo once Piccolo has actually appeared on-field.
  // Live exception: an untouched bench Piccolo can still intercept with Aura Farm.
  if ((runtime.state.boosts[piccolo.team].noAbilities || 0) > 0 && piccolo.flags.appearedOnField) return { target, damage: incoming }
  const protectedName = effectiveCardName(target) || target.definition.name
  const fatherhood = target.definition.name === 'Kid Gohan'
  piccolo.flags.farmed = true
  deck[0] = piccolo
  deck[1] = target
  boostStats(piccolo, 2)
  if (fatherhood) boostStats(piccolo, 1.5)
  pushAbilityDebug(
    runtime,
    piccolo,
    'Aura Farm protected ' + protectedName + ' from a lethal hit. Piccolo moved to the front, blocked the attack, and gained ' + (fatherhood ? '3× stats (Aura Farm + Mr. Piccolo)' : '2× stats') + '.',
  )
  return { target: piccolo, damage: 0 }
}

function dealDamage(runtime: Runtime, attacker: CombatCard, originalTarget: CombatCard, mult = 1, bypass = false): number {
  let target = originalTarget
  const confused = attacker.status.confused > 0 || attacker.flags.eternalConfusion
  const confusionSelfHit = confused && runtime.rng.next() < 0.5
  if (confusionSelfHit) target = attacker
  if (attacker.status.confused > 0 && !attacker.flags.eternalConfusion) attacker.status.confused -= 1
  if (confusionSelfHit) {
    pushAbilityDebug(runtime, attacker, 'Confusion caused this attack to hit itself.')
    const observer = active(runtime, OTHER_TEAM[attacker.team])
    if (observer && hasAbility(runtime, observer, 'Beyond Comprehension')) runAbilityTrace(runtime, observer, 'Beyond Comprehension', () => boostStats(observer, 1.5))
  }

  const frostbiteActiveOnAttack = (target.counters.frostbite || 0) > 0 && !statusProtected(runtime, target.team)

  let damage = attacker.damage * mult
  if (hasAbility(runtime, attacker, 'Jaws')) damage += target.damage
  if (attacker.status.burn > 0) damage *= 0.85
  const off = offensive(runtime, attacker, target, damage)
  damage = off.damage
  bypass = bypass || off.bypass

  const executioner = runtime.state.boosts[attacker.team].executioner
  if (executioner && target.maxHp > 0 && target.hp / target.maxHp < 0.3) {
    damage *= 1 + executioner / 100
  }

  if (attacker.status.blind && rand(runtime, attacker.team) > 0.4) { damage = 0; pushAbilityDebug(runtime, attacker, 'Blind caused the attack to miss.') }

  if (!off.special && hasAbility(runtime, target, 'All Father') && damage > 0) {
    const cost = target.maxHp / 5
    damage = 0
    target.hp -= cost
    pushAbilityDebug(runtime, target, 'All Father dodged ' + (effectiveCardName(attacker) || attacker.definition.name) + "'s normal attack and paid 20% Max HP (" + compactDebugNumber(cost) + ').')
  }

  if (statusProtected(runtime, target.team)) clearStatuses(target)
  // Erosion blocks explicit/direct kill effects (Doom, Eat The Moon, Death Embrace,
  // etc.) in their own handlers. It must not make normal attacks nonlethal just
  // because the attacker's passive modifies normal attack damage.
  if (target.status.weakness) damage *= 1.3

  target.flags.evadedThisHit = false
  const beforeDefense = damage
  if (!bypass && target.flags.eternalDevotion) {
    target.flags.eternalDevotion = false
    damage = 0
    pushAbilityDebug(runtime, target, `Eternal Devotion blocked the incoming attack from ${effectiveCardName(attacker) || attacker.definition.name}.`)
  }
  else if (!bypass && target.flags.dodgeLethal) {
    target.flags.dodgeLethal = false
    damage = 0
    pushAbilityDebug(runtime, target, `Destiny Sight dodged the incoming lethal attack from ${effectiveCardName(attacker) || attacker.definition.name}.`)
  }
  else if (!bypass) {
    const veilHolder = luminescentVeilHolder(runtime, target.team)
    const successfulEvades = target.counters.luminescentEvades || 0
    if (veilHolder && luminescentVeilCanAffect(attacker) && successfulEvades < 2) {
      const chance = Math.max(0.2, 0.4 - successfulEvades * 0.1)
      if (rand(runtime, target.team) < chance) {
        target.counters.luminescentEvades = successfulEvades + 1
        target.flags.evadedThisHit = true
        const baseDamage = veilHolder.counters.normalDamage || veilHolder.damage
        const currentGain = veilHolder.counters.luminescentVeilGain || 0
        const room = Math.max(0, baseDamage * 2 - currentGain)
        const gain = Math.min(room, Math.max(0, beforeDefense) * 0.1)
        if (gain > 0) {
          veilHolder.damage += gain
          veilHolder.counters.luminescentVeilGain = currentGain + gain
        }
        damage = 0
        pushAbilityDebug(runtime, veilHolder, 'Luminescent Veil evaded an attack on ' + (effectiveCardName(target) || target.definition.name) + '; evade ' + target.counters.luminescentEvades + '/2 used.')
      } else damage = defensive(runtime, attacker, target, damage)
    } else damage = defensive(runtime, attacker, target, damage)
  }
  if (!bypass && target.flags.evadedThisHit && hasAbility(runtime, attacker, 'ConstellarSagittarius')) damage = beforeDefense * 2

  const shielder = runtime.state.boosts[target.team].shielder
  if (shielder) damage *= (100 - shielder) / 100

  let threshold = runtime.state.boosts[target.team].synthHuman
  if (threshold && target.definition.weather === 'Time Storm') threshold *= 1.5
  if (threshold && damage < target.maxHp * threshold / 100) damage = 0

  if (target.status.shield > 0 && damage > 0) { const beforeShield = target.status.shield; target.status.shield -= 1; damage = 0; pushAbilityDebug(runtime, target, 'Shield blocked the attack; shields ' + beforeShield + ' → ' + target.status.shield + '.') }
  if (damage < 0) damage = Math.max(-(target.maxHp - target.hp), damage)
  damage = Number.isFinite(damage) ? Math.ceil(damage) : target.hp

  if ((target.counters.hpShield || 0) > 0 && damage > 0) {
    const absorbed = Math.min(target.counters.hpShield, damage)
    target.counters.hpShield -= absorbed
    damage -= absorbed
    pushAbilityDebug(runtime, target, 'ConstellarVirgo HP shield absorbed ' + compactDebugNumber(absorbed) + ' damage; ' + compactDebugNumber(target.counters.hpShield) + ' shield remains.')
  }

  const xuanwu = damage > 0 ? waterShield(runtime, target.team, target) : undefined
  if (xuanwu) {
    const redirected = Math.ceil(damage * 0.5)
    damage -= redirected
    xuanwu.hp -= Math.min(xuanwu.hp, redirected)
    pushAbilityDebug(runtime, xuanwu, 'Water Shield of Xuanwu redirected ' + compactDebugNumber(redirected) + ' damage away from ' + (effectiveCardName(target) || target.definition.name) + '.')
  }

  const farm = resolveAuraFarm(runtime, target, damage)
  target = farm.target
  damage = farm.damage
  const targetDeck = runtime.state.teams[target.team]
  let longReachTarget: CombatCard | undefined
  if (hasAbility(runtime, attacker, 'Long Reach') && targetDeck[0] === target && targetDeck.length) {
    const randomIndex = Math.min(targetDeck.length - 1, Math.floor(rand(runtime, attacker.team) * targetDeck.length))
    longReachTarget = targetDeck[randomIndex]
    pushAbilityDebug(runtime, attacker, 'Long Reach randomly targeted ' + (effectiveCardName(longReachTarget) || longReachTarget.definition.name) + ' from the living enemy deck.')
  }
  const hpTarget = longReachTarget || target
  if (hasAbility(runtime, attacker, 'Defraud')) {
    // Live-game quirk: Defraud may reduce a target but can never finish it.
    // Clamp after defensive modifiers too, so effects such as Frail cannot turn
    // the 50%-of-current-HP hit into lethal damage. Robin Hood still pays the
    // separate 25% Max HP self-cost after every attack.
    damage = Math.min(damage, hpTarget.hp * 0.5)
  }
  const appliedHpDamage = Math.min(hpTarget.hp, damage)
  hpTarget.hp -= appliedHpDamage

  const mirrorKnight = runtime.state.boosts[hpTarget.team].mirrorKnight
  if (appliedHpDamage > 0 && attacker !== hpTarget && mirrorKnight && alive(attacker)) {
    const reflected = Math.min(attacker.hp, appliedHpDamage * mirrorKnight / 100)
    if (reflected > 0) {
      attacker.hp -= reflected
      pushAbilityDebug(runtime, hpTarget, 'Mirror Knight aura reflected ' + compactDebugNumber(reflected) + ' damage back to ' + (effectiveCardName(attacker) || attacker.definition.name) + '.')
    }
  }

  if (appliedHpDamage > 0 && (hpTarget.counters.bindFatePair || 0) > 0) {
    const pair = hpTarget.counters.bindFatePair
    const partner = runtime.state.teams[hpTarget.team].find((candidate) =>
      candidate !== hpTarget && alive(candidate) && candidate.counters.bindFatePair === pair
    )
    if (partner) {
      const mirrored = Math.min(partner.hp, appliedHpDamage)
      partner.hp -= mirrored
      pushAbilityDebug(runtime, hpTarget, 'Bind Fate mirrored ' + compactDebugNumber(mirrored) + ' damage onto ' + (effectiveCardName(partner) || partner.definition.name) + '.')
    }
  }
  if (longReachTarget && longReachTarget.hp <= 0) {
    const index = targetDeck.indexOf(longReachTarget)
    if (index > 0) {
      targetDeck.splice(index, 1)
      longReachTarget.dead = true
      runtime.state.fallen[longReachTarget.team].push(longReachTarget)
    }
  }

  if (frostbiteActiveOnAttack && target.hp > 0 && runtime.rng.next() < 0.5) {
    const frostDamage = Math.min(target.hp, target.maxHp * 0.2)
    target.hp -= frostDamage
    pushAbilityDebug(runtime, target, 'Frostbite triggered for ' + compactDebugNumber(frostDamage) + ' extra damage.')
  }

  const beautifulObserver = active(runtime, OTHER_TEAM[attacker.team])
  if (hasAbility(runtime, beautifulObserver, 'Am I Beautiful?')) {
    runAbilityTrace(runtime, beautifulObserver!, 'Am I Beautiful?', () => {
      if (target.team === attacker.team) target.damage *= 0.8
      else target.status.confused += 1
    })
  }

  if ((hasAbility(runtime, target, 'Meow') || hasAbility(runtime, target, 'Never Forgotten')) && damage > 0) {
    target.counters.damageTaken = Math.min(target.maxHp, (target.counters.damageTaken || 0) + damage)
  }

  if (hasAbility(runtime, attacker, 'Disarm') && damage > 0) runAbilityTrace(runtime, attacker, 'Disarm', () => { target.damage = Math.max(0, target.damage - damage * 0.4) })
  if (hasAbility(runtime, attacker, 'Shiny Steal') && damage > 0 && target !== attacker) {
    runAbilityTrace(runtime, attacker, 'Shiny Steal', () => {
      const stolenDamage = target.damage * 0.1
      const stolenHp = target.maxHp * 0.1
      target.damage = Math.max(0, target.damage - stolenDamage)
      target.maxHp = Math.max(1, target.maxHp - stolenHp)
      target.hp = Math.min(target.hp, target.maxHp)
      attacker.damage += stolenDamage
      attacker.maxHp += stolenHp
      attacker.hp += stolenHp
    })
  }

  const flame = runtime.state.boosts[attacker.team].flameWizard
  if (!statusProtected(runtime, target.team) && flame && damage > 0 && runtime.rng.next() * 100 < flame) target.status.burn = 2
  const phantom = runtime.state.boosts[attacker.team].phantom
  if (!statusProtected(runtime, target.team) && phantom && damage > 0 && runtime.rng.next() * 100 < phantom) target.status.stunned = Math.max(1, target.status.stunned)

  if (hasAbility(runtime, target, 'Chimeric') && target.hp > 0 && target.hp <= target.maxHp / 2 && !target.flags.chimericFaded) {
    runAbilityTrace(runtime, target, 'Chimeric', () => {
      target.flags.chimericFaded = true
      target.maxHp /= 4; target.hp /= 4; target.damage /= 4
    })
  }

  targetRetro(runtime, attacker, target, damage)
  const didRegen = attackerRetro(runtime, attacker, target, damage)

  if (hasAbility(runtime, target, 'Reveal') && !target.flags.revealed && target.hp > 0 && target.hp / target.maxHp < 0.65) {
    runAbilityTrace(runtime, target, 'Reveal', () => {
      target.flags.revealed = true
      target.hp = target.maxHp
    })
  }

  const vamp = runtime.state.boosts[attacker.team].vampireMatron
  if (damage > 0 && vamp && !didRegen && alive(attacker) && vampireMatronCanHeal(attacker)) {
    const beforeHp = attacker.hp
    attacker.hp = Math.min(attacker.maxHp, attacker.hp + damage * vamp / 100)
    if (attacker.hp > beforeHp) pushAbilityDebug(runtime, attacker, 'Vampire Matron aura healed ' + compactDebugNumber(attacker.hp - beforeHp) + ' HP from this hit.')
  }

  if (target.hp <= 0) tryRevive(runtime, attacker, target)

  if (hasAbility(runtime, attacker, 'Infinite Dagger Works') && rand(runtime, attacker.team) > 0.5) { attacker.flags.extraTurn = true; pushAbilityDebug(runtime, attacker, 'Infinite Dagger Works triggered — the opponent turn will be skipped.') }
  return damage
}

function applyOnDeathCore(runtime: Runtime, dead: CombatCard, opponent: CombatCard | undefined, skipOpponentPassives = false) {
  const team = dead.team
  const deck = runtime.state.teams[team]
  const next = deck[0]
  const name = resolvedAbility(runtime, dead)

  if (!skipOpponentPassives) {
    if (opponent && alive(opponent) && hasAbility(runtime, opponent, 'Prehistoric Wrath')) {
      opponent.damage *= 2
      pushAbilityDebug(runtime, opponent, 'Prehistoric Wrath: enemy defeated; ATK doubled to ' + compactDebugNumber(opponent.damage) + '.')
    }
    if (opponent && alive(opponent) && hasAbility(runtime, opponent, 'All Father')) {
      for (const card of runtime.state.teams[opponent.team]) boostStats(card, 1.25)
      pushAbilityDebug(runtime, opponent, 'All Father: enemy defeated; all living allies gained 25% stats.')
    }
  }

  if (dead.flags.suppressOnDeath) return

  // Order of the Cosmos suppresses the defeated card's death ability too.
  // Nightmare Melody's counter decrement is cleanup for an already-created field,
  // so keep that cleanup even while the ability itself is locked.
  if ((runtime.state.boosts[team].noAbilities || 0) > 0) {
    if (name === 'Nightmare Melody' && runtime.state.boosts[team].composerCount) {
      runtime.state.boosts[team].composerCount = Math.max(0, (runtime.state.boosts[team].composerCount || 0) - 1)
    }
    return
  }

  if (activeBonusAbilities(dead).length) {
    for (const gained of activeBonusAbilities(dead)) {
      withAbility(dead, gained, () => applyOnDeath(runtime, dead, opponent, true))
    }
    return
  }

  if (name === 'Nightmare Melody' && runtime.state.boosts[team].composerCount) {
    runtime.state.boosts[team].composerCount = Math.max(0, (runtime.state.boosts[team].composerCount || 0) - 1)
    pushAbilityDebug(runtime, dead, 'Nightmare Melody field effect ended for this Composer.')
  }
  if (name === 'Hard Boiled') { runtime.state.boosts[team].fossils = (runtime.state.boosts[team].fossils || 0) + 3; pushAbilityDebug(runtime, dead, 'Hard Boiled added 3 Fossils; total ' + runtime.state.boosts[team].fossils + '.') }
  if (name === 'Extinction') { runtime.state.boosts[team].fossils = (runtime.state.boosts[team].fossils || 0) + 2; pushAbilityDebug(runtime, dead, 'Extinction added 2 Fossils; total ' + runtime.state.boosts[team].fossils + '.') }
  if (name === 'Imminent Doom' && opponent && alive(opponent) && !statusProtected(runtime, opponent.team)) {
    opponent.counters.frostbite = Math.max(opponent.counters.frostbite || 0, 2)
  }
  if (name === 'Gehenna') {
    const reviveCount = runtime.state.fallen[OTHER_TEAM[team]].length
    const candidates = runtime.state.fallen[team].filter((fallen) => fallen !== dead).slice().reverse().slice(0, reviveCount)
    const sourceDamage = (dead.counters.normalDamage || dead.damage) * 0.75
    const sourceHp = (dead.counters.normalMaxHp || dead.maxHp) * 0.75
    for (const ally of candidates) {
      const fallenIndex = runtime.state.fallen[team].indexOf(ally)
      if (fallenIndex >= 0) runtime.state.fallen[team].splice(fallenIndex, 1)
      ally.dead = false
      ally.damage = sourceDamage
      ally.maxHp = sourceHp
      ally.hp = sourceHp
      ally.entered = false
      ally.counters.normalDamage = sourceDamage
      ally.counters.normalMaxHp = sourceHp
      runtime.state.teams[team].push(ally)
    }
  }

  if (!next || !name) return
  if (name === 'Blessing') { next.damage += dead.damage / 2; next.maxHp += dead.maxHp / 2; next.hp += dead.maxHp / 2 }
  if (name === 'Meow') next.damage += (dead.counters.damageTaken || 0) * 1.5
  if (name === 'Never Forgotten') {
    const gain = (dead.counters.damageTaken || 0) * 1.25
    for (const ally of runtime.state.teams[team]) if (alive(ally)) ally.damage += gain
  }
  if (name === 'We Want YOU') {
    next.damage *= 5
    next.flags.diesAfterAttack = true
  }
  if (name === 'Better Days') {
    const revive = runtime.state.fallen[team].filter((fallen) => fallen !== dead)
    for (const ally of revive) {
      const index = runtime.state.fallen[team].indexOf(ally)
      if (index >= 0) runtime.state.fallen[team].splice(index, 1)
      ally.dead = false
      ally.hp = ally.maxHp
      ally.entered = false
      runtime.state.teams[team].push(ally)
    }
  }
  if (name === 'Heart Legacy') { next.maxHp += dead.maxHp; next.hp += dead.maxHp }
  if (name === 'Tonic') boostStats(next, 1.2)
  if (name === 'Fusion... HA!' && rand(runtime, team) > 0.5) {
    next.damage += dead.damage * 0.5
    next.maxHp += dead.maxHp * 0.5
    next.hp += dead.maxHp * 0.5
  }
  if (name === 'Destiny Sight') {
    next.flags.dodgeLethal = true
    pushAbilityDebug(runtime, dead, `Destiny Sight passed a lethal dodge to ${effectiveCardName(next) || next.definition.name}.`)
  }
  if (name === "Housewife's Blessing") { boostStats(next, 2); next.status.stunned = 2 }
  if (name === 'Eternal Devotion') {
    next.flags.eternalDevotion = true
    pushAbilityDebug(runtime, dead, `Eternal Devotion gave ${effectiveCardName(next) || next.definition.name} a one-attack shield after death.`)
  }
  if (name === 'Final Stand') {
    next.damage += dead.damage * 0.25
    next.maxHp += dead.maxHp * 0.25
    next.hp += dead.maxHp * 0.25
    next.status.shield += 1
  }
}

function applyOnDeath(runtime: Runtime, dead: CombatCard, opponent: CombatCard | undefined, skipOpponentPassives = false) {
  const name = resolvedAbility(runtime, dead)
  if (activeBonusAbilities(dead).length) return applyOnDeathCore(runtime, dead, opponent, skipOpponentPassives)
  return runAbilityTrace(runtime, dead, name, () => applyOnDeathCore(runtime, dead, opponent, skipOpponentPassives))
}

function resolveDeaths(runtime: Runtime) {
  let changed = true
  while (changed) {
    changed = false
    for (const team of ['Allies', 'Enemies'] as BattleTeam[]) {
      const deck = runtime.state.teams[team]
      const card = deck[0]
      if (!card || card.hp > 0) continue

      const guardianAngel = runtime.state.boosts[team].guardianAngel
      if (guardianAngel && !card.flags.guardianAngelUsed && runtime.rng.next() * 100 < guardianAngel) {
        card.flags.guardianAngelUsed = true
        card.hp = 1
        pushAbilityDebug(runtime, card, 'Guardian Angel prevented lethal damage and left this ally at 1 HP. Its one save for this ally is now used.')
        changed = true
        continue
      }

      if (hasAbility(runtime, card, 'Divine Ascension') && !card.flags.awakened) {
        card.flags.awakened = true
        card.abilityOverride = 'Mastered Ascension'
        card.maxHp *= 1.5
        card.damage *= 1.5
        card.hp = card.maxHp
        card.counters.normalDamage = (card.counters.normalDamage || card.damage / 1.5) * 1.5
        card.counters.normalMaxHp = (card.counters.normalMaxHp || card.maxHp / 1.5) * 1.5
        pushAbilityDebug(runtime, card, 'Divine Ascension awakened — became Mastered Ascension at 1.5× stats and full HP.')
        changed = true
        continue
      }

      if (hasAbility(runtime, card, 'Undying')) {
        if (!card.flags.undyingActive) {
          card.flags.undyingActive = true
          card.counters.undyingTurns = 1
          card.hp = 1
          pushAbilityDebug(runtime, card, 'Undying activated — lethal damage was prevented and the card survives at 1 HP for one turn.')
          changed = true
          continue
        }
        if ((card.counters.undyingTurns || 0) > 0) {
          card.hp = 1
          changed = true
          continue
        }
      }

      if (hasAbility(runtime, card, 'Unholy Creature')) {
        if (!card.flags.unholyActive) {
          card.flags.unholyActive = true
          card.counters.unholyTurns = 2
          card.counters.unholyActivatedTurn = runtime.state.turn
          card.counters.unholyLastTick = runtime.state.turn
          card.hp = 1
          pushAbilityDebug(runtime, card, 'Unholy Creature activated — lethal damage was prevented and the card survives at 1 HP for two battle turns.')
          changed = true
          continue
        }
        if ((card.counters.unholyTurns || 0) > 0) {
          card.hp = 1
          changed = true
          continue
        }
      }

      if (hasAbility(runtime, card, 'Paradox') && !card.flags.paradox) {
        card.flags.paradox = true
        card.hp = 1
        const opp = active(runtime, OTHER_TEAM[team])
        if (opp) opp.hp = 0
        pushAbilityDebug(runtime, card, `Paradox activated — survived at 1 HP and defeated ${opp ? effectiveCardName(opp) || opp.definition.name : 'the opposing card'}. This Paradox is now consumed.`)
        changed = true
        continue
      }

      const canBeyondTheGrave = hasAbility(runtime, card, 'Beyond The Grave') && !card.flags.beyondGraveRevived

      deck.shift()
      runtime.deathEpoch += 1
      card.hp = 0
      card.dead = true
      runtime.state.fallen[team].push(card)

      const finalTestament = runtime.state.boosts[team].finalTestament
      const inheritor = deck[0]
      if (inheritor && finalTestament) {
        const inheritedDamage = card.damage * finalTestament / 100
        const inheritedHp = card.maxHp * finalTestament / 100
        inheritor.damage += inheritedDamage
        inheritor.maxHp += inheritedHp
        inheritor.hp += inheritedHp
        pushAbilityDebug(runtime, card, 'Final Testament passed ' + finalTestament + '% of its ATK and Max HP to ' + (effectiveCardName(inheritor) || inheritor.definition.name) + '.')
      }

      if (runtime.captureDebug) pushDebugEvent(runtime, {
        turn: runtime.state.turn,
        type: 'death',
        team,
        card: effectiveCardName(card) || card.definition.name,
        detail: 'Card defeated',
        hp: 0,
        maxHp: card.maxHp,
        damage: card.damage,
      })

      if (!card.flags.mirrorImageReturned) {
        for (let index = runtime.state.fallen[team].length - 1; index >= 0; index--) {
          const mirror = runtime.state.fallen[team][index]
          if (mirror === card || mirror.flags.sealed || !abilityNames(mirror).includes('Mirror Image')) continue
          if (rand(runtime, team) <= 0.5) continue
          mirror.flags.mirrorImageReturned = true
          mirror.dead = false
          mirror.hp = mirror.maxHp
          mirror.entered = false
          runtime.state.fallen[team].splice(index, 1)
          deck.unshift(mirror)
          pushAbilityDebug(runtime, mirror, 'Mirror Image triggered — returned to the front at full HP after an ally died.')
        }
      }

      const opponent = active(runtime, OTHER_TEAM[team])
      applyOnDeath(runtime, card, opponent)

      if (canBeyondTheGrave) {
        // OG server source: the dying Anubis revives ITSELF once. A fresh card is
        // rebuilt from Name/Border/Power, so temporary/aura stat changes do not carry over.
        const baseMaxHp = card.power * (card.definition.hpMultiplier || 1)
        const baseDamage = card.power / 2
        const fallenIndex = runtime.state.fallen[team].indexOf(card)
        if (fallenIndex >= 0) runtime.state.fallen[team].splice(fallenIndex, 1)
        const revived: CombatCard = {
          ...card,
          id: `${card.id}:btg`,
          hp: baseMaxHp / 2,
          maxHp: baseMaxHp,
          damage: baseDamage,
          entered: false,
          dead: false,
          identityOverride: undefined,
          abilityOverride: undefined,
          bonusAbilities: undefined,
          status: { stunned: 0, confused: 0, burn: 0, weakness: false, blind: false, shield: 0 },
          flags: { beyondGraveRevived: true },
          counters: { normalDamage: baseDamage, normalMaxHp: baseMaxHp },
        }
        runtime.state.teams[team].push(revived)
        if (runtime.captureDebug) pushDebugEvent(runtime, {
          turn: runtime.state.turn,
          type: 'revive',
          team,
          card: revived.definition.name,
          detail: 'Beyond The Grave: one self-revive at half BASE HP; battle/aura stat changes reset',
          hp: revived.hp,
          maxHp: revived.maxHp,
          damage: revived.damage,
        })
      }
      changed = true
    }
  }
}

function statusStart(runtime: Runtime, attacker: CombatCard, target: CombatCard) {
  if (statusProtected(runtime, attacker.team)) clearStatuses(attacker)
  if (hasAbility(runtime, target, 'Lightning Strike') && alive(target) && alive(attacker)) {
    runAbilityTrace(runtime, target, 'Lightning Strike', () => dealDamage(runtime, target, attacker, 0.75))
  }
  const poisonPercent = attacker.counters.poisonPercent || 0
  const poisonFlat = attacker.counters.poisonFlat || 0
  if (poisonPercent) attacker.hp = Math.max(0, attacker.hp + poisonPercent * attacker.maxHp)
  else if (poisonFlat) attacker.hp = Math.max(0, attacker.hp - poisonFlat)

  if (attacker.flags.hanged) attacker.hp -= attacker.maxHp * 0.25

  if (hasAbility(runtime, target, 'Decay')) runAbilityTrace(runtime, target, 'Decay', () => { attacker.damage *= 0.75 })
  if (hasAbility(runtime, target, 'Starvation')) runAbilityTrace(runtime, target, 'Starvation', () => boostStats(attacker, 0.75))
  if (hasAbility(runtime, target, 'Purifying Fire')) runAbilityTrace(runtime, target, 'Purifying Fire', () => { attacker.hp *= 0.7 })
  if (hasAbility(runtime, attacker, 'Sacrificial Tides')) runAbilityTrace(runtime, attacker, 'Sacrificial Tides', () => { target.hp -= target.maxHp * 0.2 })
}

function tickGlobalUnholyCreature(runtime: Runtime) {
  // "Survives for two turns" is a battle-turn lifespan, not two turns taken by
  // Zombie Dragon itself. Extra-turn chains must therefore not freeze it at 1 HP.
  for (const team of ['Allies', 'Enemies'] as BattleTeam[]) {
    for (const card of runtime.state.teams[team]) {
      if (!card.flags.unholyActive) continue
      const activated = card.counters.unholyActivatedTurn || 0
      const lastTick = card.counters.unholyLastTick || activated
      if (runtime.state.turn <= activated || lastTick >= runtime.state.turn) continue
      card.counters.unholyLastTick = runtime.state.turn
      card.counters.unholyTurns = Math.max(0, (card.counters.unholyTurns || 0) - 1)
      if ((card.counters.unholyTurns || 0) <= 0) { card.hp = 0; pushAbilityDebug(runtime, card, 'Unholy Creature expired — its two-turn survival ended.') }
    }
  }
}

function tickOuroborosDecay(attacker: CombatCard) {
  if (!attacker.flags.ouroborosActive) return
  attacker.counters.ouroborosTurns = Math.max(0, (attacker.counters.ouroborosTurns || 0) - 1)
  if ((attacker.counters.ouroborosTurns || 0) > 0) return
  const damageBonus = attacker.counters.ouroborosBonusDamage || 0
  const maxHpBonus = attacker.counters.ouroborosBonusMaxHp || 0
  const hpBonus = attacker.counters.ouroborosBonusHp || 0
  attacker.damage = Math.max(0, attacker.damage - damageBonus)
  attacker.maxHp = Math.max(1, attacker.maxHp - maxHpBonus)
  attacker.hp = Math.max(0, Math.min(attacker.maxHp, attacker.hp - hpBonus))
  attacker.counters.ouroborosBonusDamage = 0
  attacker.counters.ouroborosBonusMaxHp = 0
  attacker.counters.ouroborosBonusHp = 0
  attacker.flags.ouroborosActive = false
}

function statusEnd(runtime: Runtime, attacker: CombatCard) {
  tickOuroborosDecay(attacker)
  if (statusProtected(runtime, attacker.team)) {
    clearStatuses(attacker)
    // Protection of Gods grants immunity to Status Effects; it must not freeze
    // the card's own ability lifespans. Final Tail, Unholy Creature and Undying
    // still consume their turns while Serket is alive.
    if (hasAbility(runtime, attacker, 'Final Tail')) {
      attacker.counters.finalTail = (attacker.counters.finalTail || 0) + 1
      if (attacker.counters.finalTail >= 3) { attacker.hp = 0; pushAbilityDebug(runtime, attacker, 'Final Tail expired after 3 turns — the card is defeated.') }
    }
    if (attacker.flags.undyingActive) {
      attacker.counters.undyingTurns = Math.max(0, (attacker.counters.undyingTurns || 0) - 1)
      if ((attacker.counters.undyingTurns || 0) <= 0) { attacker.hp = 0; pushAbilityDebug(runtime, attacker, 'Undying expired — its survival turn ended.') }
    }
    return
  }
  if (attacker.status.burn > 0) {
    attacker.hp -= attacker.maxHp * 0.1
    attacker.status.burn -= 1
  }
  if ((attacker.counters.bleed || 0) > 0) {
    attacker.hp -= attacker.maxHp * 0.15
    attacker.counters.bleed -= 1
  }
  if ((attacker.counters.poisonTurns || 0) > 0) {
    attacker.counters.poisonTurns -= 1
    if (attacker.counters.poisonTurns <= 0) {
      attacker.counters.poisonPercent = 0
      attacker.counters.poisonFlat = 0
    }
  }
  if ((attacker.counters.frostbite || 0) > 0) attacker.counters.frostbite -= 1
  if ((attacker.counters.death || 0) > 0 && !hasAbility(runtime, attacker, 'Erosion')) {
    attacker.counters.death -= 1
    if (attacker.counters.death <= 0) attacker.hp = 0
  }
  if (hasAbility(runtime, attacker, 'Final Tail')) {
    attacker.counters.finalTail = (attacker.counters.finalTail || 0) + 1
    if (attacker.counters.finalTail >= 3) { attacker.hp = 0; pushAbilityDebug(runtime, attacker, 'Final Tail expired after 3 turns — the card is defeated.') }
  }
  if (attacker.flags.undyingActive) {
    attacker.counters.undyingTurns = Math.max(0, (attacker.counters.undyingTurns || 0) - 1)
    if ((attacker.counters.undyingTurns || 0) <= 0) { attacker.hp = 0; pushAbilityDebug(runtime, attacker, 'Undying expired — its survival turn ended.') }
  }
  if (attacker.status.weakness && (attacker.counters.weaknessTurns || 0) > 0) {
    attacker.counters.weaknessTurns -= 1
    if (attacker.counters.weaknessTurns <= 0) attacker.status.weakness = false
  }
}

function prepareTurn(runtime: Runtime, attacker: CombatCard) {
  const composer = runtime.state.boosts[attacker.team]

  if (hasAbility(runtime, attacker, 'Cosmic Rivalry')) {
    runAbilityTrace(runtime, attacker, 'Cosmic Rivalry', () => {
      const baseDamage = attacker.counters.normalDamage || attacker.damage
      const baseMaxHp = attacker.counters.normalMaxHp || attacker.maxHp
      attacker.damage += baseDamage * 0.1
      attacker.maxHp += baseMaxHp * 0.1
      attacker.hp += baseMaxHp * 0.1
      attacker.counters.cosmicRivalryDR = Math.min(1, (attacker.counters.cosmicRivalryDR || 0) + 0.1)
    })
  }
  if (hasAbility(runtime, attacker, 'Shield of Ahimsa')) {
    attacker.counters.ahimsaTurns = (attacker.counters.ahimsaTurns || 0) + 1
    if (attacker.counters.ahimsaTurns % 2 === 0) attacker.status.shield += 1
  }
  if ((composer.composerCount || 0) > 0) {
    composer.composerThreshold = Math.max(0.6, (composer.composerThreshold ?? 1) - 0.1)
    const target = active(runtime, OTHER_TEAM[attacker.team])
    if (target && rand(runtime, attacker.team) > composer.composerThreshold) target.status.confused = 2
  }

  if (hasAbility(runtime, attacker, 'Perish') && (attacker.counters.perishTurns || 0) > 0) {
    attacker.counters.perishTurns -= 1
    if (attacker.counters.perishTurns <= 0) {
      const target = active(runtime, OTHER_TEAM[attacker.team])
      attacker.hp = 0
      if (target) target.hp = 0
      return
    }
  }
  if (attacker.flags.naughtyListDrain) runAbilityTrace(runtime, attacker, 'Naughty List', () => boostStats(attacker, 0.9))
  if (hasAbility(runtime, attacker, 'Toil')) runAbilityTrace(runtime, attacker, 'Toil', () => boostStats(attacker, 0.85))
  if (hasAbility(runtime, attacker, 'Bloodlust')) {
    if (attacker.flags.bloodlustFirstTurn) attacker.flags.bloodlustFirstTurn = false
    else runAbilityTrace(runtime, attacker, 'Bloodlust', () => { attacker.damage += attacker.counters.bloodlustBase || 0 })
  }
  if (hasAbility(runtime, attacker, 'ConstellarAquarius')) {
    runAbilityTrace(runtime, attacker, 'ConstellarAquarius', () => {
      if (attacker.hp < attacker.maxHp / 2) attacker.hp = Math.min(attacker.maxHp, attacker.hp + attacker.maxHp * 0.3)
      else attacker.maxHp *= 1.25
    })
  }
  if (hasAbility(runtime, attacker, 'Full Moon')) {
    attacker.counters.fullMoon = (attacker.counters.fullMoon || 0) + 1
    if (attacker.counters.fullMoon % 2 === 0) {
      const target = active(runtime, OTHER_TEAM[attacker.team])
      if (target && alive(target)) runAbilityTrace(runtime, attacker, 'Full Moon', () => dealDamage(runtime, target, target))
    }
  }
  if (hasAbility(runtime, attacker, 'Dark Qi Manipulation') && !attacker.flags.awakened) {
    runAbilityTrace(runtime, attacker, 'Dark Qi Manipulation', () => {
      attacker.counters.ascension = (attacker.counters.ascension || 0) + 1
      if (attacker.counters.ascension <= 2) boostStats(attacker, 1.3)
      else attacker.flags.awakened = true
    })
  }
  if (hasAbility(runtime, attacker, 'Immortal Ascension') && !attacker.flags.awakened) {
    runAbilityTrace(runtime, attacker, 'Immortal Ascension', () => {
      attacker.counters.ascension = (attacker.counters.ascension || 0) + 1
      if (attacker.counters.ascension <= 2) boostStats(attacker, 1.3)
      else attacker.flags.awakened = true
    })
  }
  if (hasAbility(runtime, attacker, 'Upheaval')) {
    attacker.counters.upheaval = (attacker.counters.upheaval || 0) + 1
    if (attacker.counters.upheaval % 3 == 0) {
      runAbilityTrace(runtime, attacker, 'Upheaval', () => {
        attacker.damage *= 2
        const target = active(runtime, OTHER_TEAM[attacker.team])
        if (target && !statusProtected(runtime, target.team)) target.status.stunned = Math.max(1, target.status.stunned)
      })
    }
  }
  if (hasAbility(runtime, attacker, 'First Tail') && (attacker.counters.tail || 0) < 9) {
    runAbilityTrace(runtime, attacker, 'First Tail', () => {
      attacker.counters.tail = (attacker.counters.tail || 0) + 1
      boostStats(attacker, 1.2)
    })
  }
  if (hasAbility(runtime, attacker, 'Shapeshifter') || attacker.flags.shapeshifterActive) {
    runAbilityTrace(runtime, attacker, 'Shapeshifter', () => {
      attacker.flags.shapeshifterActive = true
      const shape = randomBattleCard(runtime)
      attacker.identityOverride = shape.name
      attacker.abilityOverride = undefined
      attacker.entered = false
    })
  }
  if (hasAbility(runtime, attacker, 'Grind')) {
    attacker.counters.grind = (attacker.counters.grind || 0) + 1
    if (attacker.counters.grind <= 5) runAbilityTrace(runtime, attacker, 'Grind', () => boostStats(attacker, 1.1))
  }
  if (hasAbility(runtime, attacker, 'Patience')) runAbilityTrace(runtime, attacker, 'Patience', () => { attacker.damage *= 1.3 })
  if (hasAbility(runtime, attacker, 'Safeguarding')) {
    runAbilityTrace(runtime, attacker, 'Safeguarding', () => {
      for (const dragon of runtime.state.teams[attacker.team].slice(1)) {
        if (!DRAGON_CARDS.has(dragon.definition.name)) continue
        dragon.damage *= 1.2
        dragon.maxHp *= 1.2
        dragon.hp = dragon.maxHp
      }
    })
  }
  if (hasAbility(runtime, attacker, 'Absolute Sovereignty')) runAbilityTrace(runtime, attacker, 'Absolute Sovereignty', () => { for (const card of runtime.state.teams[attacker.team]) boostStats(card, 1.1) })
  if (hasAbility(runtime, attacker, 'World Creation')) {
    attacker.counters.worldCreation = (attacker.counters.worldCreation || 0) + 1
    if (attacker.counters.worldCreation % 3 === 0) {
      runAbilityTrace(runtime, attacker, 'World Creation', () => boostStats(attacker, 2))
    }
  }
  if (hasAbility(runtime, attacker, 'Persistent')) {
    const normal = attacker.counters.normalDamage || attacker.damage
    if (attacker.damage < normal) runAbilityTrace(runtime, attacker, 'Persistent', () => { attacker.damage = normal })
  }
  if (hasAbility(runtime, attacker, 'Sky Drop')) attacker.counters.drop = (attacker.counters.drop || 0) + 1
  if (hasAbility(runtime, attacker, 'Snowbound')) {
    attacker.counters.snowbound = (attacker.counters.snowbound || 0) + 1
    if (attacker.counters.snowbound % 2 === 0) runAbilityTrace(runtime, attacker, 'Snowbound', () => { attacker.status.stunned = Math.max(1, attacker.status.stunned) })
  }
  if (hasAbility(runtime, attacker, 'Defensive Maneuver')) {
    attacker.counters.defensiveManeuver = (attacker.counters.defensiveManeuver || 0) + 1
    if (attacker.counters.defensiveManeuver % 2 === 0) runAbilityTrace(runtime, attacker, 'Defensive Maneuver', () => { attacker.status.shield += 1 })
  }
}

function beforeAttack(runtime: Runtime, attacker: CombatCard) {
  const target = active(runtime, OTHER_TEAM[attacker.team])
  if (target && hasAbility(runtime, attacker, 'Blood Bath')) runAbilityTrace(runtime, attacker, 'Blood Bath', () => {
    const stolen = Math.max(0, target.hp * 0.25)
    target.hp -= stolen
    attacker.hp = Math.min(attacker.maxHp, attacker.hp + stolen)
  })
  if (hasAbility(runtime, attacker, 'Lazy')) {
    runAbilityTrace(runtime, attacker, 'Lazy', () => {
      attacker.hp = Math.min(attacker.maxHp, attacker.hp + attacker.damage * 2)
      attacker.damage *= 0.9
    })
  }
  if (target && hasAbility(runtime, attacker, 'Forbidden Banquet')) runAbilityTrace(runtime, attacker, 'Forbidden Banquet', () => stealStats(target, attacker, 0.15))
  if (hasAbility(runtime, attacker, 'Rejuvenate')) runAbilityTrace(runtime, attacker, 'Rejuvenate', () => { attacker.hp = Math.min(attacker.maxHp, attacker.hp + attacker.maxHp * 0.35) })
  if (hasAbility(runtime, attacker, 'First Progenitor')) runAbilityTrace(runtime, attacker, 'First Progenitor', () => { attacker.hp = Math.min(attacker.maxHp, attacker.hp + attacker.maxHp * 0.1) })
  if (hasAbility(runtime, attacker, 'Twilight Sparkle') && rand(runtime, attacker.team) > 0.6) runAbilityTrace(runtime, attacker, 'Twilight Sparkle', () => { attacker.hp = attacker.maxHp })
  if (target && hasAbility(runtime, attacker, 'Viral Breath')) runAbilityTrace(runtime, attacker, 'Viral Breath', () => { target.hp -= target.maxHp * 0.25 })
  if (hasAbility(runtime, attacker, 'Herbal Alchemy')) {
    runAbilityTrace(runtime, attacker, 'Herbal Alchemy', () => {
      attacker.hp = Math.min(attacker.maxHp, attacker.hp + attacker.maxHp * 0.2)
      if (rand(runtime, attacker.team) > 0.5) attacker.damage *= 1.3
    })
  }
  if (hasAbility(runtime, attacker, 'Combatant')) runAbilityTrace(runtime, attacker, 'Combatant', () => { attacker.hp = Math.min(attacker.maxHp, attacker.hp + attacker.maxHp * 0.1) })
}

function attackCount(runtime: Runtime, attacker: CombatCard): { count: number; mult: number } {
  const bonus = attacker.counters.attacks || 0
  let base = 1
  if (hasAbility(runtime, attacker, 'Rapid Blows')) base = Math.max(base, 3)
  if (hasAbility(runtime, attacker, 'Chainsaw')) base = Math.max(base, 8)
  if (hasAbility(runtime, attacker, 'Firepower')) base = Math.max(base, 5)
  if (hasAbility(runtime, attacker, 'Behavioral Therapy')) base = Math.max(base, 2)
  return { count: base + bonus, mult: 1 }
}

function canNormalAttack(runtime: Runtime, attacker: CombatCard): boolean {
  if (hasAbility(runtime, attacker, 'Dagger Storm') || hasAbility(runtime, attacker, 'Naughty or Nice?')
    || hasAbility(runtime, attacker, 'Meow') || hasAbility(runtime, attacker, 'Never Forgotten')
    || hasAbility(runtime, attacker, 'Origin') || hasAbility(runtime, attacker, 'Laser Gun')
    || hasAbility(runtime, attacker, 'Lotus Sutra')) return false
  if (hasAbility(runtime, attacker, 'Sky Drop')) return Boolean(attacker.counters.drop && attacker.counters.drop % 2 === 0)
  return true
}

function doLotusSutra(runtime: Runtime, attacker: CombatCard) {
  const fallen = runtime.state.fallen[attacker.team]
  // A Lotus Sutra user can perform its revive once per battle. This prevents
  // Buddha and Hades (after copying Lotus Sutra) from reviving each other forever.
  const deadAlly = attacker.flags.lotusReviveUsed
    ? undefined
    : [...fallen].reverse().find((card) => card !== attacker)
  if (deadAlly) {
    attacker.flags.lotusReviveUsed = true
    const index = fallen.indexOf(deadAlly)
    if (index >= 0) fallen.splice(index, 1)
    deadAlly.dead = false
    deadAlly.hp = deadAlly.maxHp * 0.5
    deadAlly.entered = false
    runtime.state.teams[attacker.team].push(deadAlly)
    pushAbilityDebug(runtime, attacker, `Lotus Sutra revived ${effectiveCardName(deadAlly) || deadAlly.definition.name} at 50% HP and placed it at the back of the team.`)
    return
  }

  const allies = runtime.state.teams[attacker.team].filter((card) => card !== attacker && alive(card))
  const target = allies.sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)[0]
  if (!target) {
    pushAbilityDebug(runtime, attacker, 'Lotus Sutra had no fallen or living ally to target, so nothing happened this turn.')
    return
  }
  const before = target.hp
  target.hp = Math.min(target.maxHp, target.hp + target.maxHp * 0.5)
  const healed = target.hp - before
  let moved = false
  if (target.hp >= target.maxHp) {
    const deck = runtime.state.teams[attacker.team]
    const index = deck.indexOf(attacker)
    if (index >= 0 && deck.length > 1) {
      deck.splice(index, 1)
      deck.push(attacker)
      moved = true
    }
  }
  pushAbilityDebug(runtime, attacker, `Lotus Sutra healed ${effectiveCardName(target) || target.definition.name} for ${Math.ceil(healed)} HP${moved ? ' and moved the Lotus Sutra user to the back of the team' : ''}.`)
}

function doOrigin(runtime: Runtime, attacker: CombatCard) {
  const enemyTeam = OTHER_TEAM[attacker.team]
  for (let hit = 0; hit < 4; hit++) {
    const deck = runtime.state.teams[enemyTeam].filter(alive)
    if (!deck.length || !alive(attacker)) break
    const target = deck[Math.floor(runtime.rng.next() * deck.length)]
    dealDamage(runtime, attacker, target, 0.5)
    resolveDeaths(runtime)
  }
}

function doLaserGun(runtime: Runtime, attacker: CombatCard) {
  if (!attacker.flags.laserCharged) {
    attacker.flags.laserCharged = true
    pushAbilityDebug(runtime, attacker, 'Laser Gun is charging; it will fire on the next turn.')
    return
  }
  attacker.flags.laserCharged = false
  const enemyTeam = OTHER_TEAM[attacker.team]
  const targets = Math.min(3, (runtime.state.boosts[attacker.team].fossils || 0) + 1)
  for (const target of runtime.state.teams[enemyTeam].slice(0, targets)) {
    if (!alive(attacker) || !alive(target)) continue
    dealDamage(runtime, attacker, target, 0.75)
  }
  resolveDeaths(runtime)
}

function applyCollateralAfterHit(runtime: Runtime, attacker: CombatCard, target: CombatCard, dealt: number) {
  if (dealt <= 0) return
  const enemyTeam = OTHER_TEAM[attacker.team]

  if (hasAbility(runtime, attacker, 'Railgun')) {
    runAbilityTrace(runtime, attacker, 'Railgun', () => {
      const splash = Math.ceil(dealt * 0.3)
      for (const enemy of runtime.state.teams[enemyTeam]) {
        if (enemy.hp > 0) enemy.hp -= Math.min(enemy.hp, splash)
      }
    })
  }

  if (hasAbility(runtime, attacker, 'Outshine')) {
    runAbilityTrace(runtime, attacker, 'Outshine', () => {
      const deck = runtime.state.teams[enemyTeam]
      const index = deck.indexOf(target)
      const next = index >= 0 ? deck[index + 1] : deck[1]
      if (next && next.hp > 0) {
        const before = next.hp
        next.hp -= Math.min(next.hp, dealt)
        if (before > 0 && next.hp <= 0) next.flags.suppressOnDeath = true
      }
    })
  }
}

function processTeamTurnAbilities(runtime: Runtime, movedTeam: BattleTeam, movedCard: CombatCard) {
  const defendingTeam = OTHER_TEAM[movedTeam]
  const dispel = active(runtime, defendingTeam)
  if (dispel && alive(dispel) && hasAbility(runtime, dispel, 'Dispel') && alive(movedCard)) {
    runAbilityTrace(runtime, dispel, 'Dispel', () => {
      const drained = movedCard.damage * 0.2
      movedCard.damage = Math.max(0, movedCard.damage - drained)
      dispel.hp = Math.min(dispel.maxHp, dispel.hp + drained)
    })
  }

  for (const healer of runtime.state.teams[movedTeam]) {
    if (!alive(healer) || !hasAbility(runtime, healer, 'Healing Miracle') || healer === movedCard) continue
    healer.counters.healingMiracle = (healer.counters.healingMiracle || 0) + 1
    if (healer.counters.healingMiracle >= 3) {
      runAbilityTrace(runtime, healer, 'Healing Miracle', () => {
        healer.counters.healingMiracle = 0
        healer.hp = Math.min(healer.maxHp, healer.hp + healer.maxHp)
      })
    }
  }
}

function doDaggerStorm(runtime: Runtime, attacker: CombatCard) {
  const enemyTeam = OTHER_TEAM[attacker.team]
  for (const mult of [0.5, 1, 2]) {
    const target = active(runtime, enemyTeam)
    if (!target || !alive(attacker)) break
    dealDamage(runtime, attacker, target, mult)
    resolveDeaths(runtime)
  }
}

function doNaughtyOrNice(runtime: Runtime, attacker: CombatCard) {
  const target = active(runtime, OTHER_TEAM[attacker.team])
  if (!target || !alive(attacker)) return
  if (rand(runtime, attacker.team) < 0.8) {
    dealDamage(runtime, attacker, target, 4)
    resolveDeaths(runtime)
  } else {
    target.hp = Math.min(target.maxHp, target.hp + target.maxHp * 0.5)
  }
}

function doTurn(runtime: Runtime, attacker: CombatCard) {
  const enemyTeam = OTHER_TEAM[attacker.team]
  let target = active(runtime, enemyTeam)
  if (!target || !alive(attacker)) return

  prepareTurn(runtime, attacker)
  resolveDeaths(runtime)
  if (!alive(attacker)) return
  target = active(runtime, enemyTeam)
  if (!target) return
  statusStart(runtime, attacker, target)
  resolveDeaths(runtime)
  if (!alive(attacker)) return
  target = active(runtime, enemyTeam)
  if (!target) return

  beforeAttack(runtime, attacker)

  if (hasAbility(runtime, attacker, 'Lotus Sutra')) runAbilityTrace(runtime, attacker, 'Lotus Sutra', () => doLotusSutra(runtime, attacker))
  else if (hasAbility(runtime, attacker, 'Origin')) runAbilityTrace(runtime, attacker, 'Origin', () => doOrigin(runtime, attacker))
  else if (hasAbility(runtime, attacker, 'Laser Gun')) runAbilityTrace(runtime, attacker, 'Laser Gun', () => doLaserGun(runtime, attacker))
  else if (hasAbility(runtime, attacker, 'Dagger Storm')) runAbilityTrace(runtime, attacker, 'Dagger Storm', () => doDaggerStorm(runtime, attacker))
  else if (hasAbility(runtime, attacker, 'Naughty or Nice?')) runAbilityTrace(runtime, attacker, 'Naughty or Nice?', () => doNaughtyOrNice(runtime, attacker))

  if (hasAbility(runtime, attacker, 'Chaos Destruction') && rand(runtime, attacker.team) > 0.5) {
    const deck = runtime.state.teams[enemyTeam]
    if (deck.length > 1) {
      const previousFront = deck[0]
      const swapIndex = 1 + Math.floor(runtime.rng.next() * (deck.length - 1))
      const swappedIn = deck[swapIndex]
      ;[deck[0], deck[swapIndex]] = [deck[swapIndex], deck[0]]
      target = deck[0]
      pushAbilityDebug(
        runtime,
        attacker,
        'Chaos Destruction swapped the enemy current card from ' + (effectiveCardName(previousFront) || previousFront.definition.name) + ' to ' + (effectiveCardName(swappedIn) || swappedIn.definition.name) + '. The next attack deals 3× damage.',
      )
      onEntry(runtime, target)
      resolveDeaths(runtime)
    } else {
      pushAbilityDebug(runtime, attacker, 'Chaos Destruction triggered. There was no other enemy card to swap in, and the next attack deals 3× damage.')
    }
    attacker.flags.chaosTriple = true
  }

  if (canNormalAttack(runtime, attacker)) {
    const { count } = attackCount(runtime, attacker)
    for (let i = 0; i < count; i++) {
      target = active(runtime, enemyTeam)
      if (!target || !alive(attacker)) break
      const dealt = dealDamage(runtime, attacker, target)
      applyCollateralAfterHit(runtime, attacker, target, dealt)
      resolveDeaths(runtime)
      let insatiableChainCount = 0
      while (attacker.flags.insatiableAttack && alive(attacker) && active(runtime, enemyTeam)) {
        // A confirmed-kill chain should be finite. Keep a hard same-turn guard so
        // a future revive/death-prevention interaction can never freeze the worker.
        if (++insatiableChainCount > 64) {
          attacker.flags.insatiableAttack = false
          if (runtime.captureDebug) pushDebugEvent(runtime, {
            turn: runtime.state.turn, type: 'stall', team: attacker.team,
            card: effectiveCardName(attacker) || attacker.definition.name,
            detail: 'Insatiable same-turn chain stopped at safety limit',
            hp: attacker.hp, maxHp: attacker.maxHp, damage: attacker.damage,
          })
          break
        }
        attacker.flags.insatiableAttack = false
        dealDamage(runtime, attacker, active(runtime, enemyTeam)!)
        resolveDeaths(runtime)
      }
      if (hasAbility(runtime, attacker, 'Black Flash') && alive(attacker) && target.hp > 0) {
        dealDamage(runtime, attacker, target, 0.5, true)
      }
      resolveDeaths(runtime)

      const stormSpirit = runtime.state.boosts[attacker.team].stormSpirit
      const stormTarget = active(runtime, enemyTeam)
      // Live behavior: Overcharge does not roll onto the next enemy when the
      // primary attack killed the card it originally struck.
      if (stormSpirit && stormTarget && alive(attacker) && alive(target) && runtime.rng.next() * 100 < stormSpirit) {
        pushAbilityDebug(runtime, attacker, 'Storm Spirit triggered — immediately attacking again at 50% damage.')
        const stormDamage = dealDamage(runtime, attacker, stormTarget, 0.5)
        applyCollateralAfterHit(runtime, attacker, stormTarget, stormDamage)
        resolveDeaths(runtime)
      }
    }
  }

  const creepTarget = active(runtime, enemyTeam)
  if (creepTarget && alive(attacker)) {
    for (const creep of runtime.state.teams[attacker.team].slice(1)) {
      if (hasAbility(runtime, creep, 'Creep') && alive(creep) && active(runtime, enemyTeam)) {
        runAbilityTrace(runtime, creep, 'Creep', () => {
          dealDamage(runtime, creep, active(runtime, enemyTeam)!, 0.25)
          resolveDeaths(runtime)
        })
      }
    }
  }

  const currentTarget = active(runtime, enemyTeam)
  if (currentTarget && alive(currentTarget) && alive(attacker)) {
    const berserker = runtime.state.boosts[currentTarget.team].berserker
    const shouldCounter = (berserker && runtime.rng.next() * 100 < berserker)
      || hasAbility(runtime, currentTarget, 'Hatred')
      || hasAbility(runtime, currentTarget, 'Perseverance')
      || hasAbility(runtime, currentTarget, 'Spikes')
      || hasAbility(runtime, currentTarget, 'Blood Drinker')
      || hasAbility(runtime, currentTarget, 'Stolen Spotlight')
      || hasAbility(runtime, currentTarget, 'Poke the Beast')
      || (hasAbility(runtime, currentTarget, 'Absolute Apex') && (runtime.state.boosts[currentTarget.team].fossils || 0) > 2)
    if (shouldCounter) {
      const counterName = hasAbility(runtime, currentTarget, 'Hatred') ? 'Hatred'
        : hasAbility(runtime, currentTarget, 'Perseverance') ? 'Perseverance'
        : hasAbility(runtime, currentTarget, 'Spikes') ? 'Spikes'
        : hasAbility(runtime, currentTarget, 'Blood Drinker') ? 'Blood Drinker'
        : hasAbility(runtime, currentTarget, 'Stolen Spotlight') ? 'Stolen Spotlight'
        : hasAbility(runtime, currentTarget, 'Poke the Beast') ? 'Poke the Beast'
        : hasAbility(runtime, currentTarget, 'Absolute Apex') ? 'Absolute Apex'
        : 'Berserker aura'
      pushAbilityDebug(runtime, currentTarget, counterName + ' triggered a counterattack against ' + (effectiveCardName(attacker) || attacker.definition.name) + '.')
      dealDamage(runtime, currentTarget, attacker, hasAbility(runtime, currentTarget, 'Perseverance') ? 0.1 : 1)
    }
  }

  if (hasAbility(runtime, attacker, 'Martial Will') && alive(attacker)) runAbilityTrace(runtime, attacker, 'Martial Will', () => { attacker.damage *= 1.3 })

  if (hasAbility(runtime, attacker, 'Eternal Voyage') && alive(attacker)) {
    runAbilityTrace(runtime, attacker, 'Eternal Voyage', () => {
      const deck = runtime.state.teams[attacker.team]
      const selfIndex = deck.indexOf(attacker)
      const choices = deck.map((_, index) => index).filter((index) => index !== selfIndex)
      if (selfIndex >= 0 && choices.length) {
        const swapIndex = choices[Math.floor(runtime.rng.next() * choices.length)]
        ;[deck[selfIndex], deck[swapIndex]] = [deck[swapIndex], deck[selfIndex]]
      }
    })
  }

  if (attacker.flags.diesAfterAttack && alive(attacker)) { attacker.hp = 0; pushAbilityDebug(runtime, attacker, 'We Want YOU expired — the boosted card was sacrificed after its attack.') }

  statusEnd(runtime, attacker)
  processTeamTurnAbilities(runtime, attacker.team, attacker)
  resolveDeaths(runtime)

  // Source behavior: Order of the Cosmos counts down only when the locked team
  // completes one of its turns. This also suppresses on-entry abilities while active.
  const lock = runtime.state.boosts[attacker.team].noAbilities || 0
  if (lock > 0) runtime.state.boosts[attacker.team].noAbilities = lock > 1 ? lock - 1 : undefined
}

function processDivination(runtime: Runtime) {
  const allCards = [
    ...runtime.state.teams.Allies, ...runtime.state.fallen.Allies,
    ...runtime.state.teams.Enemies, ...runtime.state.fallen.Enemies,
  ]
  for (const card of allCards) {
    if (!hasAbility(runtime, card, 'Divination') || card.flags.divinationFired) continue
    const moves = card.counters.divinationMoves || 0
    if (moves <= 0) continue
    card.counters.divinationMoves = moves - 1
    if (card.counters.divinationMoves <= 0) {
      card.flags.divinationFired = true
      const target = active(runtime, OTHER_TEAM[card.team])
      if (target) {
        runAbilityTrace(runtime, card, 'Divination', () => {
          dealDamage(runtime, card, target, 3, true)
          resolveDeaths(runtime)
        })
      }
    }
  }
}

function growHiddenInDepths(runtime: Runtime, moving: BattleTeam) {
  if (moving !== 'Allies') return
  const deck = runtime.state.teams.Allies
  for (let index = 1; index < deck.length; index++) {
    const card = deck[index]
    if (hasAbility(runtime, card, 'Hidden in the Depths')) {
      runAbilityTrace(runtime, card, 'Hidden in the Depths', () => {
        const baseDamage = card.counters.normalDamage || card.damage
        const baseMaxHp = card.counters.normalMaxHp || card.maxHp
        const damageBonus = card.counters.hiddenDepthsBonusDamage || 0
        const hpBonus = card.counters.hiddenDepthsBonusHp || 0
        const addDamage = Math.min(baseDamage * 0.1, Math.max(0, baseDamage * 2 - damageBonus))
        const addHp = Math.min(baseMaxHp * 0.1, Math.max(0, baseMaxHp * 2 - hpBonus))
        card.damage += addDamage
        card.maxHp += addHp
        card.hp += addHp
        card.counters.hiddenDepthsBonusDamage = damageBonus + addDamage
        card.counters.hiddenDepthsBonusHp = hpBonus + addHp
      })
    }
  }
}

function scheduleExtraTurns(runtime: Runtime, attacker: CombatCard): boolean {
  let extra = attacker.flags.extraTurn
  attacker.flags.extraTurn = false

  if (!attacker.flags.onBonusTurn) {
    let count = 0
    if (hasAbility(runtime, attacker, 'Berserk') && attacker.hp / attacker.maxHp < 0.5) count += 1
    if (hasAbility(runtime, attacker, 'Melancholy') && attacker.hp / attacker.maxHp > 0.5) count += 2
    if (hasAbility(runtime, attacker, 'Haste')) count += 1
    if (hasAbility(runtime, attacker, 'First Progenitor')) count += 1
    if (hasAbility(runtime, attacker, 'The World')) {
      if (attacker.flags.worldCooldown) attacker.flags.worldCooldown = false
      else { count += 2; attacker.flags.worldCooldown = true }
    }
    if (hasAbility(runtime, attacker, 'Accelerate')) {
      attacker.counters.turnsPerTurn = (attacker.counters.turnsPerTurn || 0) + 1
      count += attacker.counters.turnsPerTurn
    }
    if (count > 0) {
      attacker.counters.extraTurns = count
      const sources = [
        hasAbility(runtime, attacker, 'Berserk') && attacker.hp / attacker.maxHp < 0.5 ? 'Berserk' : '',
        hasAbility(runtime, attacker, 'Melancholy') && attacker.hp / attacker.maxHp > 0.5 ? 'Melancholy' : '',
        hasAbility(runtime, attacker, 'Haste') ? 'Haste' : '',
        hasAbility(runtime, attacker, 'First Progenitor') ? 'First Progenitor' : '',
        hasAbility(runtime, attacker, 'The World') ? 'The World' : '',
        hasAbility(runtime, attacker, 'Accelerate') ? 'Accelerate' : '',
      ].filter(Boolean)
      pushAbilityDebug(runtime, attacker, sources.join(' + ') + ': queued ' + count + ' extra turn' + (count === 1 ? '' : 's') + '.')
    }
  }

  if ((attacker.counters.extraTurns || 0) > 0) {
    attacker.counters.extraTurns -= 1
    attacker.flags.onBonusTurn = true
    extra = true
  } else attacker.flags.onBonusTurn = false
  return extra
}

export function simulateBattleV2(
  loadout: TeamLoadout,
  enemies: DepthsEnemy[],
  seed = 1,
  maxTurns = 2_000,
  markTurnCap = false,
  captureDebug = false,
  onProgress?: (turn: number) => void,
): BattleResult {
  const state = createBattleStateV2(loadout, enemies)
  const debug: BattleDebug = {
    initialAllies: [], initialEnemies: [], finalAllies: [], finalEnemies: [], events: [], forcedStallResolutions: 0,
    statAura: loadout.statAura ? { name: loadout.statAura.auraName, border: loadout.statAura.border || null, value: state.boosts.Allies.statAuraValue } : undefined,
    abilityAura: loadout.abilityAura ? { name: loadout.abilityAura.auraName, border: loadout.abilityAura.border || null, value: state.boosts.Allies.skillAuraValue } : undefined,
  }
  const runtime: Runtime = { state, rng: new SeededRng(seed), debug, captureDebug, deathEpoch: 0 }
  resolveConstellarArts(runtime)
  if (captureDebug) {
    debug.initialAllies = state.teams.Allies.map(debugCard)
    debug.initialEnemies = state.teams.Enemies.map(debugCard)
  }
  let turnsWithoutDeaths = 0
  let lastDeathEpoch = runtime.deathEpoch
  let turnLimitReached = false
  while (state.teams.Allies.length && state.teams.Enemies.length && state.turn < maxTurns) {
    state.turn += 1
    // Heartbeat for the outer browser watchdog. This is intentionally sparse so
    // normal fast battles do not spam worker messages, while long battles still
    // prove that the engine is actively advancing.
    if (state.turn % 5 === 0) onProgress?.(state.turn)
    tickGlobalUnholyCreature(runtime)
    resolveDeaths(runtime)
    let attacker = active(runtime, state.moving)
    let defender = active(runtime, OTHER_TEAM[state.moving])
    if (!attacker || !defender) break

    onEntry(runtime, attacker)
    defender = active(runtime, OTHER_TEAM[state.moving])
    if (defender) onEntry(runtime, defender)
    resolveDeaths(runtime)
    attacker = active(runtime, state.moving)
    defender = active(runtime, OTHER_TEAM[state.moving])
    if (!attacker || !defender) break

    if (runtime.deathEpoch !== lastDeathEpoch) {
      turnsWithoutDeaths = 0
      lastDeathEpoch = runtime.deathEpoch
    }
    turnsWithoutDeaths += 1
    if (turnsWithoutDeaths >= 150) {
      debug.forcedStallResolutions += 1
      if (runtime.captureDebug) pushDebugEvent(runtime, {
        turn: state.turn,
        type: 'stall',
        team: state.moving,
        card: effectiveCardName(attacker) || attacker.definition.name,
        detail: `Expansion 150-turn no-progress resolution vs ${effectiveCardName(defender) || defender.definition.name}: both active cards defeated`,
        hp: attacker.hp, maxHp: attacker.maxHp, damage: attacker.damage,
      })
      attacker.hp = 0
      defender.hp = 0
      resolveDeaths(runtime)
      continue
    }
    if (runtime.captureDebug) pushDebugEvent(runtime, {
      turn: state.turn,
      type: 'turn',
      team: state.moving,
      card: effectiveCardName(attacker) || attacker.definition.name,
      detail: `vs ${effectiveCardName(defender) || defender.definition.name} | attacker ${Math.ceil(attacker.hp)}/${Math.ceil(attacker.maxHp)} HP ${Math.ceil(attacker.damage)} ATK | defender ${Math.ceil(defender.hp)}/${Math.ceil(defender.maxHp)} HP ${Math.ceil(defender.damage)} ATK`,
      hp: attacker.hp, maxHp: attacker.maxHp, damage: attacker.damage,
    })

    doTurn(runtime, attacker)
    processDivination(runtime)
    growHiddenInDepths(runtime, state.moving)
    resolveDeaths(runtime)
    if (!state.teams.Allies.length || !state.teams.Enemies.length) break

    const stillActive = active(runtime, state.moving)
    const extra = stillActive === attacker && alive(attacker) ? scheduleExtraTurns(runtime, attacker) : false
    if (!extra) {
      const nextTeam = OTHER_TEAM[state.moving]
      const next = active(runtime, nextTeam)
      if (next && statusProtected(runtime, nextTeam)) clearStatuses(next)
      if (next && next.status.stunned > 0) {
        next.status.stunned -= 1
      } else if (next && next.flags.slowed) {
        next.counters.slowed = (next.counters.slowed || 0) + 1
        if ((next.counters.slowTurns || 0) > 0) {
          next.counters.slowTurns -= 1
          if (next.counters.slowTurns <= 0) next.flags.slowed = false
        }
        if (next.counters.slowed % 2 === 0) state.moving = nextTeam
      } else {
        state.moving = nextTeam
      }
    }
  }

  if (markTurnCap && state.turn >= maxTurns && state.teams.Allies.length && state.teams.Enemies.length) {
    state.unsupportedAbilities.add('Battle turn cap reached')
  }

  const winner: BattleResult['winner'] = state.teams.Allies.length
    ? state.teams.Enemies.length ? 'Draw' : 'Allies'
    : state.teams.Enemies.length ? 'Enemies' : 'Draw'
  const unsupportedAbilities = [...state.unsupportedAbilities].sort()
  if (captureDebug) {
    debug.finalAllies = state.teams.Allies.map(debugCard)
    debug.finalEnemies = state.teams.Enemies.map(debugCard)
  }
  return { winner, turns: state.turn, state, unsupportedAbilities, trusted: unsupportedAbilities.length === 0, turnLimitReached, debug: captureDebug ? debug : undefined }
}
