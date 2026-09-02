import auras from '../data/auras'

export const UNDEAD_CARDS = new Set([
  'Ghoul', 'Dracula', 'Walking Dead', 'Zombie Dragon', 'Zombie Nurse', 'Skeleton King',
  'Vampire Lord', 'Hades', 'Anubis', 'Anubis & Hades', 'Count Muscula', 'Baby Skeleton',
  'Frankenstein', 'Mummy', 'Jiāngshī', 'Zombie', 'Banshee', 'Revenant',
  'Headless Horseman', 'Bloody Mary', 'Pestilence', 'Famine', 'War', 'Death',
])

export const DEMON_CARDS = new Set([
  'Beelzebub', 'Tartarus', 'Krampus', 'Demonic Cultivator', 'Heavenly Demon', 'Fafnir',
  'Vicious', 'AK4-ON1', 'A0-ON1', 'Shuten-dōji', "Hell's Army", 'Sable The Envious',
])

export const RNG_ABILITIES = new Set([
  'Evasion', 'Blinding Flash', 'True Strike', 'Frigid Touch', 'Revive', 'Self-Destruct',
  'Eternity', 'Frozen Ashes', 'Dagger', 'Guerilla Warfare', 'Fusion... HA!', 'Armageddon',
  'Favorable Odds', "Reaper's Luck", 'Invisibility', 'Chaos Destruction',
  'Creation and Restoration', 'Herbal Alchemy', 'Gambler', 'Untouchable', 'Divine Mist',
  'Origin', "Pandora's Box", 'Naughty or Nice?', 'Snowscape', 'Divine Ascension',
  'Six Realms Staff', 'Kitchen', 'Vajra Short Sword', 'Staff of Perfect Enlightenment',
  'Great Nirvana Sword - Zero',
])

function boostedCards(auraName: string) {
  return new Set(auras.find((aura) => aura.name === auraName)?.boostedCards || [])
}

export const DRAGON_CARDS = boostedCards('Dragon King')
export const AVIAN_CARDS = boostedCards('Avian King')
export const IMP_BOOSTED_CARDS = boostedCards('Imp')
