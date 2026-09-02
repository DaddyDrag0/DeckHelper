import cards from '../data/cards'
import type { CardDefinition, DepthsEnemy } from '../types'
import { getAttack, getHealth } from './stats'
import { SeededRng } from './rng'

const HARD_EXCLUSIONS = new Set(['Vampire Lord', 'Parallax', 'Samurai'])
export const LEGACY_DEPTHS_BANS = ['Samurai', 'Seraphim', 'Loki', 'Fuxi', 'Parallax', 'Nán Fāng Zhū Què', 'Brachiosaurus', 'Jersey Devil'] as const
const LEGACY_DEPTHS_BAN_SET = new Set<string>(LEGACY_DEPTHS_BANS)

export const MAX_DEPTH_BANS = 14

function normalizeDepthBans(names: readonly string[] | undefined): string[] {
  if (!names?.length) return []
  const seen = new Set<string>()
  const normalized: string[] = []
  for (const rawName of names) {
    const name = String(rawName || '').trim()
    if (!name || seen.has(name)) continue
    seen.add(name)
    normalized.push(name)
    if (normalized.length >= MAX_DEPTH_BANS) break
  }
  return normalized.sort((a, b) => a.localeCompare(b))
}

const WEATHER_WEIGHTS: Record<string, number> = {
  Storm: 0.5,
  Snow: 0.5,
  Aurora: 0.3,
  'Meteor Shower': 0.2,
  'Blood Rain': 0.1,
  Shroud: 0.1,
  Eclipse: 0.1,
  Rapture: 0.05,
  Virus: 0.2,
}

interface PreparedDepthsCard {
  card: CardDefinition
  weight: number
  unlockFloor: number
  originalIndex: number
}

interface PreparedPool {
  entries: PreparedDepthsCard[]
  cumulative: number[]
  totalWeight: number
}

export function depthBudget(floor: number): number {
  return 3000 + Math.pow(floor, 2.75) * 40
}

export function depthsPower(floor: number): number {
  return Math.ceil(Math.sqrt(depthBudget(floor) * 2))
}

export function isDepthsSourceEligible(card: CardDefinition): boolean {
  return !card.unobtainable
    && !card.expires
    && !card.boss
    && !HARD_EXCLUSIONS.has(card.name)
    && card.pack !== 'Christmas'
    && card.pack !== 'Halloween'
    && card.pack !== 'Halloween2'
}

function minimumUnlockFloor(card: CardDefinition): number {
  const threshold = getAttack(card) * getHealth(card)
  if (threshold < depthBudget(1)) return 1

  const approximate = Math.max(1, Math.floor(Math.pow(Math.max(0, threshold - 3000) / 40, 1 / 2.75)))
  let floor = approximate
  while (floor > 1 && threshold < depthBudget(floor - 1)) floor -= 1
  while (!(threshold < depthBudget(floor))) floor += 1
  return floor
}

const PREPARED = cards
  .map((card, originalIndex) => ({
    card,
    originalIndex,
    weight: card.weather ? (WEATHER_WEIGHTS[card.weather] ?? 1) : 1,
    unlockFloor: isDepthsSourceEligible(card) ? minimumUnlockFloor(card) : Number.POSITIVE_INFINITY,
  }))
  .filter((entry) => Number.isFinite(entry.unlockFloor))

const UNLOCK_FLOORS = [...new Set(PREPARED.map((entry) => entry.unlockFloor))].sort((a, b) => a - b)
const POOL_CACHE = new Map<number, PreparedPool>()
const CUSTOM_BAN_POOL_CACHE = new Map<string, PreparedPool>()

function unlockTier(floor: number): number {
  let low = 0
  let high = UNLOCK_FLOORS.length
  while (low < high) {
    const mid = (low + high) >>> 1
    if (UNLOCK_FLOORS[mid] <= floor) low = mid + 1
    else high = mid
  }
  return low - 1
}

function preparedPool(floor: number, bannedCardNames: readonly string[] = [], rebanLegacyDepths = false): PreparedPool {
  const tier = unlockTier(floor)
  if (tier < 0) return { entries: [], cumulative: [], totalWeight: 0 }

  const bans = normalizeDepthBans(bannedCardNames)
  const cacheKey = bans.length || rebanLegacyDepths
    ? `${tier}|${rebanLegacyDepths ? 'legacy|' : ''}${bans.join('\u0000')}`
    : ''
  const cached = cacheKey ? CUSTOM_BAN_POOL_CACHE.get(cacheKey) : POOL_CACHE.get(tier)
  if (cached) return cached

  const maxUnlockFloor = UNLOCK_FLOORS[tier]
  const banned = bans.length ? new Set(bans) : null
  const legacyBanned = rebanLegacyDepths ? LEGACY_DEPTHS_BAN_SET : null
  const entries = PREPARED
    .filter((entry) => entry.unlockFloor <= maxUnlockFloor && !banned?.has(entry.card.name) && !legacyBanned?.has(entry.card.name))
    .sort((a, b) => a.originalIndex - b.originalIndex)

  const cumulative: number[] = []
  let totalWeight = 0
  for (const entry of entries) {
    totalWeight += entry.weight
    cumulative.push(totalWeight)
  }

  const pool = { entries, cumulative, totalWeight }
  if (cacheKey) CUSTOM_BAN_POOL_CACHE.set(cacheKey, pool)
  else POOL_CACHE.set(tier, pool)
  return pool
}

export function isUnlockedAtFloor(card: CardDefinition, floor: number): boolean {
  if (!isDepthsSourceEligible(card)) return false
  return getAttack(card) * getHealth(card) < depthBudget(floor)
}

export function getDepthsPool(floor: number, bannedCardNames: readonly string[] = [], rebanLegacyDepths = false) {
  const pool = preparedPool(floor, bannedCardNames, rebanLegacyDepths)
  return pool.entries.map(({ card, weight }) => ({ card, weight }))
}

function pickWeighted(pool: PreparedPool, roll: number): CardDefinition {
  let low = 0
  let high = pool.cumulative.length - 1
  while (low < high) {
    const mid = (low + high) >>> 1
    if (roll < pool.cumulative[mid]) high = mid
    else low = mid + 1
  }
  return pool.entries[low].card
}

export function generateDepthsTeam(floor: number, seed = floor, bannedCardNames: readonly string[] = [], rebanLegacyDepths = false): DepthsEnemy[] {
  const pool = preparedPool(floor, bannedCardNames, rebanLegacyDepths)
  const rng = new SeededRng(seed)
  const power = depthsPower(floor)
  const result: DepthsEnemy[] = []

  if (!pool.entries.length || pool.totalWeight <= 0) return result

  for (let slot = 0; slot < 4; slot++) {
    const picked = pickWeighted(pool, rng.next() * pool.totalWeight)
    result.push({
      card: picked,
      power,
      attack: power / 2,
      health: power * (picked.hpMultiplier || 1),
    })
  }

  return result
}

export const depthsMechanics = {
  budgetFormula: '3000 + floor^2.75 × 40',
  enemyCount: 4,
  duplicateEnemiesAllowed: true,
  weatherWeights: WEATHER_WEIGHTS,
  hardExclusions: [...HARD_EXCLUSIONS],
  legacyHardExclusions: [...LEGACY_DEPTHS_BANS],
  maxPlayerBans: MAX_DEPTH_BANS,
}
