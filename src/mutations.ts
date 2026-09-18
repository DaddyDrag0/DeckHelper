import type { CardDefinition, MutationWeather } from './types'

export const MUTATION_WEATHERS: readonly MutationWeather[] = [
  'Storm',
  'Snow',
  'Aurora',
  'Shroud',
  'Meteor Shower',
  'Time Storm',
  'Eclipse',
  'Virus',
  'Blood Rain',
  'Armageddon',
  'Manga',
] as const

const MUTATION_WEATHER_SET = new Set<string>(MUTATION_WEATHERS)

export function isMutationWeather(value: unknown): value is MutationWeather {
  return typeof value === 'string' && MUTATION_WEATHER_SET.has(value)
}

export function mutationEligibleCard(
  card: Pick<CardDefinition, 'weather' | 'boss' | 'unobtainable' | 'expires'> | null | undefined,
): boolean {
  if (!card) return false
  // The game also blocks Sin cards; every Sin card in the current calculator data is a boss,
  // so the boss restriction covers that source rule without inventing a separate card flag.
  return !card.weather && !card.boss && !card.unobtainable && !card.expires
}

export function normalizeMutationWeather(
  value: unknown,
  card?: Pick<CardDefinition, 'weather' | 'boss' | 'unobtainable' | 'expires'> | null,
): MutationWeather | null {
  if (!isMutationWeather(value)) return null
  if (card && !mutationEligibleCard(card)) return null
  return value
}

export function mutationLabel(weather?: MutationWeather | null): string {
  return weather ? `${weather} Mutation` : 'No Mutation'
}
