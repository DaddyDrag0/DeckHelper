import cards from '../data/cards'
import { isDepthsSourceEligible } from './depths'

export const SOURCE_ALIGNED_ABILITIES = new Set([
  'Gathering', 'Remembrance', 'Am I Beautiful?', 'Persistent', 'Chimeric',
  'First Progenitor', 'Undead Practitioner', 'Big and Large', 'Patience', 'Blade',
  'Clawless', 'Catastrophe', 'Frail', 'Fight Dirty', 'Assassinate', "Humanity's Spirit",
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
  'Mr. Piccolo', 'Sudden Demise', 'Hidden in the Depths', 'Terror From Above',
  'God of Thunder', 'All Father', 'Fire World', 'Into The Sun', 'Eat The Moon',
  'Dirty Claw', 'Death Embrace', 'Blood Drinker', 'Drain Vitality',
  'Fury of the White Tiger', 'Defraud', 'Unforgiving', 'Grape Juice',
  'Perfect Sacrifice', 'Guilt', 'Melt', 'Boiling Blood', 'Run As Fast As You Can',
  'Bind', 'Guerilla Warfare', 'Avalon', 'Reflective Shell', 'Firepower', 'Chainsaw',
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
  'Flames of Rebirth', 'God of Trickery', 'Long Reach', 'Order of the Cosmos', 'Sacred Judgment',
  'A Pair of Two', 'Final Stand', 'Heard but not Seen', 'Lights Way', 'Eclipse',
  'Friendship', 'Fusion... HA!', 'Divine Mist', 'Dark Qi Manipulation',
  'Immortal Ascension', 'Hard Boiled', 'Tyrannospirit', 'Absolute Apex', 'Last Meal',
  'Stolen Spotlight', 'Horned Attack', 'Creep', 'Protection of Gods', 'Upheaval',
  'Deadly Ambush', 'Erosion', 'Divination', 'Insatiable', 'Poke the Beast',
  'Full Moon', 'Unholy Creature', 'The Underworld', 'Devilish', 'Chaos Destruction',
  'Beyond The Grave', 'Creation and Restoration', 'Dispel', 'Healing Miracle',
  'Laser Gun', 'Lotus Sutra', 'Origin', 'Outshine', 'Pandemic', 'Railgun',
  'Shiny Steal', 'Water Shield of Xuanwu', 'Constellar', "Pandora's Box",
  'Cosmic Rivalry', 'Divine Ascension', 'Kitchen', 'Six Realms Staff',
])

export function getDepthsAbilityCoverage() {
  const abilities = new Set(
    cards.filter(isDepthsSourceEligible).map((card) => card.ability).filter((x): x is string => Boolean(x)),
  )
  const supported = [...abilities].filter((ability) => SOURCE_ALIGNED_ABILITIES.has(ability)).sort()
  const unsupported = [...abilities].filter((ability) => !SOURCE_ALIGNED_ABILITIES.has(ability)).sort()
  return {
    total: abilities.size,
    supported: supported.length,
    unsupported: unsupported.length,
    supportedAbilities: supported,
    unsupportedAbilities: unsupported,
    percent: abilities.size ? (supported.length / abilities.size) * 100 : 100,
  }
}
