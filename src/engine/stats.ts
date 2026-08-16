import type { BorderName, CardDefinition, TeamCard } from '../types'

export const BORDER_RARITY_MULTIPLIERS: Record<BorderName, number> = {
  Platinum: 100,
  Crystal: 10_000,
  Ruby: 100_000,
  Galaxy: 1_000_000,
}

export function rarityWithBorders(card: CardDefinition, borders: BorderName[] = []): number {
  return borders.reduce((rarity, border) => rarity * BORDER_RARITY_MULTIPLIERS[border], card.rarity)
}

export function getPower(card: CardDefinition, borders: BorderName[] = []): number {
  // Expansion Util.GetPower. Limited borders Great/Mighty/Almighty are intentionally unsupported.
  const rarity = card.name === 'Ouroboros' ? 100_000_000_000_000 : rarityWithBorders(card, borders)
  if (rarity <= 0) return 0
  return Math.pow(2, Math.log10(rarity)) * 10 * (card.statMultiplier || 1)
}

export function getHealth(card: CardDefinition, borders: BorderName[] = []): number {
  return getPower(card, borders) * (card.hpMultiplier || 1)
}

export function getAttack(card: CardDefinition, borders: BorderName[] = []): number {
  return getPower(card, borders) / 2
}

export function getTeamCardStats(card: CardDefinition, teamCard: TeamCard) {
  return {
    power: getPower(card, teamCard.borders),
    attack: getAttack(card, teamCard.borders),
    health: getHealth(card, teamCard.borders),
    effectiveRarity: rarityWithBorders(card, teamCard.borders),
  }
}
