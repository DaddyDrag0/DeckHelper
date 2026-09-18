import type { BorderName, CardDefinition, MutationWeather, TeamCard } from '../types'

export const BORDER_RARITY_MULTIPLIERS: Record<BorderName, number> = {
  Platinum: 100,
  Crystal: 10_000,
  Ruby: 100_000,
  Galaxy: 1_000_000,
}

export const WEATHER_MUTATION_STAT_MULTIPLIERS: Record<MutationWeather, number> = {
  Storm: 1.1,
  Snow: 1.2,
  Aurora: 1.3,
  Shroud: 1.5,
  'Meteor Shower': 1.8,
  'Time Storm': 2,
  Eclipse: 2.5,
  Virus: 3,
  'Blood Rain': 3.5,
  Armageddon: 4,
  Manga: 4.5,
}

export function mutationStatMultiplier(weather?: MutationWeather | null): number {
  return weather ? WEATHER_MUTATION_STAT_MULTIPLIERS[weather] ?? 1 : 1
}

export function rarityWithBorders(card: CardDefinition, borders: BorderName[] = []): number {
  return borders.reduce((rarity, border) => rarity * BORDER_RARITY_MULTIPLIERS[border], card.rarity)
}

export function getPower(card: CardDefinition, borders: BorderName[] = [], mutationWeather?: MutationWeather | null): number {
  // Expansion Util.GetPower. Limited borders Great/Mighty/Almighty are intentionally unsupported.
  const rarity = card.name === 'Ouroboros' ? 100_000_000_000_000 : rarityWithBorders(card, borders)
  if (rarity <= 0) return 0
  return Math.pow(2, Math.log10(rarity)) * 10 * (card.statMultiplier || 1) * mutationStatMultiplier(mutationWeather)
}

export function getHealth(card: CardDefinition, borders: BorderName[] = [], mutationWeather?: MutationWeather | null): number {
  return getPower(card, borders, mutationWeather) * (card.hpMultiplier || 1)
}

export function getAttack(card: CardDefinition, borders: BorderName[] = [], mutationWeather?: MutationWeather | null): number {
  return getPower(card, borders, mutationWeather) / 2
}

export function getTeamCardStats(card: CardDefinition, teamCard: TeamCard) {
  return {
    power: getPower(card, teamCard.borders, teamCard.mutationWeather),
    attack: getAttack(card, teamCard.borders, teamCard.mutationWeather),
    health: getHealth(card, teamCard.borders, teamCard.mutationWeather),
    effectiveRarity: rarityWithBorders(card, teamCard.borders),
  }
}
