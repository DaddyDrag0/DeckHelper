import type { BorderName, TeamCard } from './types'

export const CARD_BORDER_ORDER: BorderName[] = ['Platinum', 'Crystal', 'Ruby', 'Galaxy']

export function canonicalBorders(borders: readonly BorderName[] = []): BorderName[] {
  const selected = new Set(borders)
  return CARD_BORDER_ORDER.filter((border) => selected.has(border))
}

export function borderKey(borders: readonly BorderName[] = []): string {
  return canonicalBorders(borders).join('+')
}

export function bordersFromKey(key: string): BorderName[] {
  if (!key || key === 'Base') return []
  const selected = new Set(key.split('+'))
  return CARD_BORDER_ORDER.filter((border) => selected.has(border))
}

export function cardVariantKey(cardName: string, borders: readonly BorderName[] = []): string {
  return `${cardName}\u0000${borderKey(borders)}`
}

export function teamCardVariantKey(card: Pick<TeamCard, 'cardName' | 'borders'>): string {
  return cardVariantKey(card.cardName, card.borders)
}

export function borderVariantLabel(borders: readonly BorderName[] = []): string {
  const ordered = canonicalBorders(borders)
  return ordered.length ? ordered.join(' + ') : 'Base'
}

export interface BorderVariantDefinition {
  key: string
  borders: BorderName[]
  label: string
}

export const ALL_CARD_BORDER_VARIANTS: BorderVariantDefinition[] = Array.from({ length: 1 << CARD_BORDER_ORDER.length }, (_, mask) => {
  const borders = CARD_BORDER_ORDER.filter((_, index) => Boolean(mask & (1 << index)))
  return { key: borderKey(borders), borders, label: borderVariantLabel(borders) }
})

export function firstUnusedBorderVariant(existing: Iterable<readonly BorderName[]>): BorderName[] | null {
  const used = new Set(Array.from(existing, (borders) => borderKey(borders)))
  return ALL_CARD_BORDER_VARIANTS.find((variant) => !used.has(variant.key))?.borders ?? null
}
