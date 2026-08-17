import cards from '../data/cards'
import auras from '../data/auras'
import type {
  InventoryState,
  OptimizerProgress,
  OwnedAura,
  OwnedCard,
  RankedTeam,
  ReplacementResult,
  SearchSettings,
  TeamMetrics,
} from '../app-types'
import { auraSelection } from '../app-types'
import type { AuraSelection, TeamCard, TeamLoadout } from '../types'
import { createBattleStateV2, simulateBattleV2 } from '../engine/battle-v2'
import { generateDepthsTeam } from '../engine/depths'
import { getPower } from '../engine/stats'
import { cardVariantKey, canonicalBorders, teamCardVariantKey } from '../card-variants'

const CARD_BY_NAME = new Map(cards.map((card) => [card.name, card] as const))
const AURA_BY_NAME = new Map(auras.map((aura) => [aura.name, aura] as const))

const SEARCH_SEED_POOL_SIZE = 32
const QUICK_TRIALS = 5
const MAX_EXHAUSTIVE_COMBINATIONS = 100_000
const SMALL_SEARCH_MIDDLE_CAP = 600
const SMALL_SEARCH_ORDER_CAP = 96
const SMALL_SEARCH_FINALIST_CAP = 30

function makeSearchSeeds(count = SEARCH_SEED_POOL_SIZE): number[] {
  const size = Math.max(1, Math.floor(count))
  const values = new Uint32Array(size)
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(values)
  } else {
    const random = xorshift((Date.now() ^ Math.floor(Math.random() * 0xffff_ffff)) >>> 0)
    for (let index = 0; index < size; index++) values[index] = Math.floor(random() * 0x1_0000_0000) >>> 0
  }
  return Array.from(values, (value, index) => value || ((0x9e3779b9 ^ Math.imul(index + 1, 0x85ebca6b)) >>> 0))
}

export const DEFAULT_SEARCH_SETTINGS: SearchSettings = {
  candidateCap: MAX_EXHAUSTIVE_COMBINATIONS,
  quickCandidateCap: 1_000,
  middleCandidateCap: 120,
  finalistCap: 10,
  finalSeedCount: 15,
  maxFloor: 100_000,
}

interface Candidate {
  names: string[]
  loadout: TeamLoadout
  heuristic: number
  quickEstimate: number
  quickAverage: number
  quickBest: number
  middleEstimate: number
  trusted: boolean
  unsupported: Set<string>
}

interface ProbeResult {
  wins: number
  runs: number
  averageTurns: number
  trusted: boolean
  unsupported: string[]
}

interface ThresholdResult {
  estimate: number
  simulations: number
  trusted: boolean
  unsupported: string[]
}

interface SearchRuntime {
  simulations: number
  possibleCombinations: number
  quickTested: number
  remainingCandidates: number
  finalists: number
  fullySimulated: number
  fullySimulatedTotal: number
}

function settingsWithDefaults(settings?: Partial<SearchSettings>): SearchSettings {
  return {
    candidateCap: Math.max(100, Math.floor(settings?.candidateCap ?? DEFAULT_SEARCH_SETTINGS.candidateCap)),
    quickCandidateCap: Math.max(20, Math.floor(settings?.quickCandidateCap ?? DEFAULT_SEARCH_SETTINGS.quickCandidateCap)),
    middleCandidateCap: Math.max(10, Math.floor(settings?.middleCandidateCap ?? DEFAULT_SEARCH_SETTINGS.middleCandidateCap)),
    finalistCap: Math.max(3, Math.floor(settings?.finalistCap ?? DEFAULT_SEARCH_SETTINGS.finalistCap)),
    finalSeedCount: Math.max(3, Math.floor(settings?.finalSeedCount ?? DEFAULT_SEARCH_SETTINGS.finalSeedCount)) | 1,
    maxFloor: Math.max(100, Math.floor(settings?.maxFloor ?? DEFAULT_SEARCH_SETTINGS.maxFloor)),
  }
}

function emitProgress(
  runtime: SearchRuntime,
  phase: OptimizerProgress['phase'],
  callback: (progress: OptimizerProgress) => void,
  currentBest?: RankedTeam,
  message?: string,
) {
  callback({
    phase,
    possibleCombinations: runtime.possibleCombinations,
    quickTested: runtime.quickTested,
    remainingCandidates: runtime.remainingCandidates,
    finalists: runtime.finalists,
    fullySimulated: runtime.fullySimulated,
    fullySimulatedTotal: runtime.fullySimulatedTotal,
    simulations: runtime.simulations,
    currentBest,
    message,
  })
}

function boundedChoiceCount(items: Array<{ card: OwnedCard; capacity: number }>, choose: number): number {
  const dp = new Array(choose + 1).fill(0)
  dp[0] = 1
  for (const item of items) {
    const next = new Array(choose + 1).fill(0)
    for (let used = 0; used <= choose; used++) {
      if (!dp[used]) continue
      for (let take = 0; take <= Math.min(item.capacity, choose - used); take++) {
        next[used + take] = Math.min(Number.MAX_SAFE_INTEGER, next[used + take] + dp[used])
      }
    }
    for (let index = 0; index <= choose; index++) dp[index] = next[index]
  }
  return dp[choose]
}

function cardRawScore(card: OwnedCard): number {
  const definition = CARD_BY_NAME.get(card.cardName)
  if (!definition) return 0
  const power = getPower(definition, card.borders)
  const hpFactor = Math.max(0.25, definition.hpMultiplier || 1)
  return Math.log10(power + 10) * Math.sqrt(hpFactor)
}

function ownedCardToTeamCard(card: OwnedCard): TeamCard {
  return { cardName: card.cardName, borders: canonicalBorders(card.borders) }
}

function validateInventory(inventory: InventoryState) {
  const validCards = inventory.cards.filter((card) => CARD_BY_NAME.has(card.cardName) && card.quantity >= 1)
  const totalCopies = validCards.reduce((sum, card) => sum + card.quantity, 0)
  if (totalCopies < 4) throw new Error('Add at least 4 total card copies to your inventory before searching.')

  const locked = validCards.filter((card) => card.locked || card.lockedPosition !== null)
  if (locked.length > 4) throw new Error('You can lock at most 4 cards.')

  const positions = new Set<number>()
  for (const card of locked) {
    if (card.lockedPosition === null) continue
    if (positions.has(card.lockedPosition)) throw new Error(`More than one card is locked to position ${card.lockedPosition + 1}.`)
    positions.add(card.lockedPosition)
  }
  return { validCards, locked }
}

function buildDefaultOrder(variantKeys: string[], inventoryMap: Map<string, OwnedCard>): TeamCard[] {
  const slots: Array<TeamCard | null> = [null, null, null, null]
  const remaining: OwnedCard[] = []
  const positioned = new Set<string>()
  for (const key of variantKeys) {
    const owned = inventoryMap.get(key)
    if (!owned) continue
    if (owned.lockedPosition !== null && !positioned.has(key)) {
      slots[owned.lockedPosition] = ownedCardToTeamCard(owned)
      positioned.add(key)
    } else remaining.push(owned)
  }
  remaining.sort((a, b) => cardRawScore(b) - cardRawScore(a))
  for (let slot = 0; slot < slots.length; slot++) {
    if (!slots[slot]) slots[slot] = ownedCardToTeamCard(remaining.shift()!)
  }
  return slots.filter((card): card is TeamCard => Boolean(card))
}

function expandAuraOptions(owned: OwnedAura[], lockedOnly: boolean): Array<AuraSelection | null> {
  const source = lockedOnly ? owned.filter((aura) => aura.locked) : owned
  const options: Array<AuraSelection | null> = []
  if (!lockedOnly) options.push(null)
  for (const aura of source) {
    if (!AURA_BY_NAME.has(aura.auraName)) continue
    for (const border of aura.borders.length ? aura.borders : ['Base' as const]) {
      options.push(auraSelection(aura.auraName, border))
    }
  }
  return options.length ? options : [null]
}

function auraOptions(inventory: InventoryState, type: 'stat' | 'ability'): Array<AuraSelection | null> {
  const owned = type === 'stat' ? inventory.statAuras : inventory.abilityAuras
  const locked = owned.filter((aura) => aura.locked)
  if (locked.length > 1) throw new Error(`Only one ${type === 'stat' ? 'Stat' : 'Ability'} Aura can be locked at a time.`)
  return expandAuraOptions(owned, locked.length === 1)
}

function rawLoadoutScore(cards: TeamCard[], statAura: AuraSelection | null): number {
  const loadout: TeamLoadout = { cards, statAura, abilityAura: null }
  const state = createBattleStateV2(loadout, [])
  let score = 0
  for (const card of state.teams.Allies) {
    score += Math.log10(Math.max(1, card.damage)) * 0.48
    score += Math.log10(Math.max(1, card.maxHp)) * 0.52
  }
  return score
}

function bestStatAuras(cards: TeamCard[], options: Array<AuraSelection | null>, count = 1): Array<AuraSelection | null> {
  return options
    .map((aura) => ({ aura, score: rawLoadoutScore(cards, aura) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, count))
    .map((entry) => entry.aura)
}

function initialFloorGuess(loadout: TeamLoadout, maxFloor: number): number {
  const state = createBattleStateV2(loadout, [])
  if (!state.teams.Allies.length) return 1
  const equivalents = state.teams.Allies.map((card) => {
    const hpMultiplier = Math.max(0.05, card.definition.hpMultiplier || 1)
    const hpPower = card.maxHp / hpMultiplier
    const attackPower = card.damage * 2
    return Math.sqrt(Math.max(1, hpPower * attackPower))
  }).sort((a, b) => a - b)
  const middle = equivalents[Math.floor(equivalents.length / 2)] || equivalents[0]
  const budget = Math.max(0, middle * middle / 2 - 3000)
  const floor = Math.pow(budget / 40, 1 / 2.75)
  return Math.max(1, Math.min(maxFloor, Math.round(Number.isFinite(floor) ? floor : 1)))
}

function mixSeed(runSeed: number, floor: number): number {
  let x = (runSeed ^ Math.imul(floor, 0x9e3779b1)) >>> 0
  x ^= x >>> 16
  x = Math.imul(x, 0x85ebca6b) >>> 0
  x ^= x >>> 13
  x = Math.imul(x, 0xc2b2ae35) >>> 0
  return (x ^ (x >>> 16)) >>> 0
}

function probeFloor(loadout: TeamLoadout, floor: number, seeds: number[], runtime: SearchRuntime): ProbeResult {
  let wins = 0
  let turns = 0
  let trusted = true
  const unsupported = new Set<string>()
  for (const seed of seeds) {
    const floorSeed = mixSeed(seed, floor)
    const enemies = generateDepthsTeam(floor, floorSeed)
    const battle = simulateBattleV2(loadout, enemies, floorSeed ^ 0x51ed270b, 2_000, true, false)
    runtime.simulations += 1
    if (battle.winner === 'Allies') wins += 1
    turns += battle.turns
    trusted = trusted && battle.trusted
    for (const ability of battle.unsupportedAbilities) unsupported.add(ability)
  }
  return {
    wins,
    runs: seeds.length,
    averageTurns: turns / Math.max(1, seeds.length),
    trusted,
    unsupported: [...unsupported],
  }
}

function estimateThreshold(
  loadout: TeamLoadout,
  seeds: number[],
  runtime: SearchRuntime,
  maxFloor: number,
  initial?: number,
  binarySteps = 4,
): ThresholdResult {
  const cache = new Map<number, ProbeResult>()
  let trusted = true
  const unsupported = new Set<string>()
  const before = runtime.simulations

  const winsAt = (floor: number) => {
    const normalized = Math.max(1, Math.min(maxFloor, Math.round(floor)))
    let probe = cache.get(normalized)
    if (!probe) {
      probe = probeFloor(loadout, normalized, seeds, runtime)
      cache.set(normalized, probe)
      trusted = trusted && probe.trusted
      for (const ability of probe.unsupported) unsupported.add(ability)
    }
    return probe.wins / Math.max(1, probe.runs) >= 0.5
  }

  let guess = Math.max(1, Math.min(maxFloor, Math.round(initial ?? initialFloorGuess(loadout, maxFloor))))
  let low = 0
  let high = maxFloor

  if (winsAt(guess)) {
    low = guess
    let next = Math.min(maxFloor, Math.max(guess + 1, Math.round(guess * 1.65 + 25)))
    while (next < maxFloor && winsAt(next)) {
      low = next
      next = Math.min(maxFloor, Math.max(next + 1, Math.round(next * 1.65 + 25)))
    }
    if (next === maxFloor && winsAt(next)) return { estimate: maxFloor, simulations: runtime.simulations - before, trusted, unsupported: [...unsupported] }
    high = next
  } else {
    high = guess
    let next = Math.max(1, Math.floor(guess / 1.65))
    while (next > 1 && !winsAt(next)) {
      high = next
      next = Math.max(1, Math.floor(next / 1.65))
    }
    if (next === 1 && !winsAt(1)) return { estimate: 1, simulations: runtime.simulations - before, trusted, unsupported: [...unsupported] }
    low = next
  }

  for (let step = 0; step < binarySteps && high - low > 1; step++) {
    const mid = Math.floor((low + high) / 2)
    if (winsAt(mid)) low = mid
    else high = mid
  }

  return {
    estimate: Math.max(1, (low + high) / 2),
    simulations: runtime.simulations - before,
    trusted,
    unsupported: [...unsupported],
  }
}

function xorshift(seed: number) {
  let state = seed >>> 0 || 0x9e3779b9
  return () => {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    return (state >>> 0) / 0x1_0000_0000
  }
}

function enumerateMultisets(
  items: Array<{ card: OwnedCard; capacity: number }>,
  choose: number,
  limit: number,
  callback: (picked: OwnedCard[]) => void,
) {
  const picked: OwnedCard[] = []
  let emitted = 0
  const walk = (index: number, remaining: number) => {
    if (emitted >= limit) return
    if (remaining === 0) {
      emitted += 1
      callback([...picked])
      return
    }
    if (index >= items.length) return
    const item = items[index]
    const maxTake = Math.min(item.capacity, remaining)
    for (let take = maxTake; take >= 0 && emitted < limit; take--) {
      for (let count = 0; count < take; count++) picked.push(item.card)
      walk(index + 1, remaining - take)
      for (let count = 0; count < take; count++) picked.pop()
    }
  }
  walk(0, choose)
}

function generateTeamNameSets(inventory: InventoryState, cap: number): { sets: string[][]; possible: number } {
  const { validCards, locked } = validateInventory(inventory)
  const reserved = new Map<string, number>()
  for (const card of locked) {
    const key = cardVariantKey(card.cardName, card.borders)
    reserved.set(key, (reserved.get(key) ?? 0) + 1)
  }
  const need = 4 - locked.length
  const selectable = validCards
    .map((card) => {
      const key = cardVariantKey(card.cardName, card.borders)
      return { card, capacity: Math.min(4, Math.max(0, card.quantity - (reserved.get(key) ?? 0))) }
    })
    .filter((entry) => entry.capacity > 0)
  const possible = need === 0 ? 1 : boundedChoiceCount(selectable, need)
  const sets: string[][] = []
  const seen = new Set<string>()

  const add = (extras: OwnedCard[]) => {
    if (extras.length !== need) return
    const keys = [
      ...locked.map((card) => cardVariantKey(card.cardName, card.borders)),
      ...extras.map((card) => cardVariantKey(card.cardName, card.borders)),
    ]
    if (keys.length !== 4) return
    const key = [...keys].sort().join('\u0000')
    if (seen.has(key)) return
    seen.add(key)
    sets.push(keys)
  }

  if (need === 0) return { sets: [locked.map((card) => cardVariantKey(card.cardName, card.borders))], possible: 1 }

  const ranked = [...selectable].sort((a, b) => cardRawScore(b.card) - cardRawScore(a.card))
  if (possible > cap) {
    throw new Error(
      `Your inventory has ${possible.toLocaleString()} possible teams. DeckHelper now requires an exhaustive search and will not silently skip combinations. `
      + `The current exhaustive limit is ${cap.toLocaleString()}; reduce the inventory or lock cards to narrow the search.`,
    )
  }

  enumerateMultisets(ranked, need, possible, add)
  if (sets.length !== possible) {
    throw new Error(`Exhaustive candidate generation expected ${possible.toLocaleString()} teams but produced ${sets.length.toLocaleString()}.`)
  }
  return { sets, possible }
}

function preselectByHeuristic(candidates: Candidate[], cap: number): Candidate[] {
  if (candidates.length <= cap) return candidates.sort((a, b) => b.heuristic - a.heuristic)
  const sorted = [...candidates].sort((a, b) => b.heuristic - a.heuristic)
  const eliteCount = Math.min(Math.floor(cap * 0.75), sorted.length)
  const selected = sorted.slice(0, eliteCount)
  const remainder = sorted.slice(eliteCount)
  const need = cap - selected.length
  for (let index = 0; index < need && remainder.length; index++) {
    const at = Math.floor(index * remainder.length / need)
    selected.push(remainder[at])
  }
  return selected
}

function permutations<T>(values: T[]): T[][] {
  const result: T[][] = []
  const used = new Array(values.length).fill(false)
  const current: T[] = []
  const walk = () => {
    if (current.length === values.length) {
      result.push([...current])
      return
    }
    for (let index = 0; index < values.length; index++) {
      if (used[index]) continue
      used[index] = true
      current.push(values[index])
      walk()
      current.pop()
      used[index] = false
    }
  }
  walk()
  return result
}

function validOrders(cards: TeamCard[], inventoryMap: Map<string, OwnedCard>): TeamCard[][] {
  const lockedPositions = [...inventoryMap.values()].filter((card) => card.lockedPosition !== null)
  const seen = new Set<string>()
  return permutations(cards).filter((order) => {
    const key = order.map((card) => `${card.cardName}:${card.borders.join('+')}`).join('|')
    if (seen.has(key)) return false
    seen.add(key)
    return lockedPositions.every((owned) => {
      const at = order[owned.lockedPosition as number]
      return Boolean(at) && teamCardVariantKey(at) === cardVariantKey(owned.cardName, owned.borders)
    })
  })
}

function probeScore(loadout: TeamLoadout, center: number, runtime: SearchRuntime, maxFloor: number, seeds: number[]): number {
  const floors = [0.94, 1, 1.06].map((factor) => Math.max(1, Math.min(maxFloor, Math.round(center * factor))))
  let score = 0
  for (const floor of floors) {
    const probe = probeFloor(loadout, floor, seeds.slice(0, 3), runtime)
    score += probe.wins * 1_000
    score -= probe.averageTurns * 0.01
  }
  return score
}

function optimizeAuraAndOrder(
  candidate: Candidate,
  inventory: InventoryState,
  inventoryMap: Map<string, OwnedCard>,
  runtime: SearchRuntime,
  maxFloor: number,
  seeds: number[],
): Candidate {
  const statOptions = bestStatAuras(candidate.loadout.cards, auraOptions(inventory, 'stat'), 2)
  const abilityOptions = auraOptions(inventory, 'ability')

  const auraPairs: Array<{ statAura: AuraSelection | null; abilityAura: AuraSelection | null; score: number }> = []
  for (const statAura of statOptions) {
    for (const abilityAura of abilityOptions) {
      const loadout: TeamLoadout = { cards: candidate.loadout.cards, statAura, abilityAura }
      auraPairs.push({ statAura, abilityAura, score: probeScore(loadout, candidate.middleEstimate, runtime, maxFloor, seeds) })
    }
  }
  auraPairs.sort((a, b) => b.score - a.score)
  const bestPairs = auraPairs.slice(0, Math.min(2, auraPairs.length))

  let bestLoadout = candidate.loadout
  let bestScore = Number.NEGATIVE_INFINITY
  const orders = validOrders(candidate.loadout.cards, inventoryMap)
  for (const pair of bestPairs) {
    for (const order of orders) {
      const loadout: TeamLoadout = { cards: order, statAura: pair.statAura, abilityAura: pair.abilityAura }
      const score = probeScore(loadout, candidate.middleEstimate, runtime, maxFloor, seeds)
      if (score > bestScore) {
        bestScore = score
        bestLoadout = loadout
      }
    }
  }

  return { ...candidate, loadout: bestLoadout }
}

function metricStats(values: number[], trusted: boolean, unsupported: Set<string>): TeamMetrics {
  const sorted = [...values].sort((a, b) => a - b)
  const average = sorted.reduce((sum, value) => sum + value, 0) / Math.max(1, sorted.length)
  const middle = Math.floor(sorted.length / 2)
  const median = sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
  const variance = sorted.reduce((sum, value) => sum + Math.pow(value - average, 2), 0) / Math.max(1, sorted.length)
  return {
    averageDepth: average,
    medianDepth: median,
    minimumDepth: sorted[0] ?? 1,
    maximumDepth: sorted[sorted.length - 1] ?? 1,
    consistency: Math.sqrt(variance),
    samples: sorted.length,
    trusted,
    unsupportedAbilities: [...unsupported].sort(),
  }
}

function finalMetrics(
  loadout: TeamLoadout,
  center: number,
  seedCount: number,
  seeds: number[],
  runtime: SearchRuntime,
  maxFloor: number,
): TeamMetrics {
  const values: number[] = []
  let trusted = true
  const unsupported = new Set<string>()
  for (let index = 0; index < seedCount; index++) {
    const threshold = estimateThreshold(loadout, [seeds[index % seeds.length]], runtime, maxFloor, center, 5)
    values.push(threshold.estimate)
    trusted = trusted && threshold.trusted
    for (const ability of threshold.unsupported) unsupported.add(ability)
  }
  return metricStats(values, trusted, unsupported)
}

function compareRankedTeams(a: RankedTeam, b: RankedTeam): number {
  return b.metrics.medianDepth - a.metrics.medianDepth
    || b.metrics.averageDepth - a.metrics.averageDepth
    || b.metrics.minimumDepth - a.metrics.minimumDepth
    || a.metrics.consistency - b.metrics.consistency
    || b.metrics.maximumDepth - a.metrics.maximumDepth
}

function rankedId(loadout: TeamLoadout): string {
  const cardsKey = loadout.cards.map((card) => `${card.cardName}:${card.borders.join('+')}`).join('|')
  const stat = loadout.statAura ? `${loadout.statAura.auraName}:${loadout.statAura.border || 'Base'}` : '-'
  const ability = loadout.abilityAura ? `${loadout.abilityAura.auraName}:${loadout.abilityAura.border || 'Base'}` : '-'
  return `${cardsKey}::${stat}::${ability}`
}

export function searchBestTeams(
  inventory: InventoryState,
  settingsInput: Partial<SearchSettings> | undefined,
  onProgress: (progress: OptimizerProgress) => void,
): RankedTeam[] {
  const settings = settingsWithDefaults(settingsInput)
  const searchSeeds = makeSearchSeeds(Math.max(SEARCH_SEED_POOL_SIZE, settings.finalSeedCount))
  const { validCards } = validateInventory(inventory)
  const inventoryMap = new Map(validCards.map((card) => [cardVariantKey(card.cardName, card.borders), card] as const))
  const statOptions = auraOptions(inventory, 'stat')
  auraOptions(inventory, 'ability')

  const generated = generateTeamNameSets(inventory, settings.candidateCap)
  const runtime: SearchRuntime = {
    simulations: 0,
    possibleCombinations: generated.possible,
    quickTested: 0,
    remainingCandidates: generated.sets.length,
    finalists: 0,
    fullySimulated: 0,
    fullySimulatedTotal: 0,
  }
  emitProgress(runtime, 'prepare', onProgress, undefined, 'Preparing candidate teams')

  let candidates = generated.sets.map((names): Candidate => {
    const ordered = buildDefaultOrder(names, inventoryMap)
    const statAura = bestStatAuras(ordered, statOptions, 1)[0] ?? null
    const loadout: TeamLoadout = { cards: ordered, statAura, abilityAura: null }
    return {
      names,
      loadout,
      heuristic: rawLoadoutScore(ordered, statAura),
      quickEstimate: 1,
      quickAverage: 1,
      quickBest: 1,
      middleEstimate: 1,
      trusted: true,
      unsupported: new Set<string>(),
    }
  })

  const exhaustiveQuick = generated.sets.length === generated.possible
  if (!exhaustiveQuick) throw new Error('Optimizer candidate generation was not exhaustive.')
  runtime.remainingCandidates = candidates.length
  emitProgress(
    runtime,
    'quick',
    onProgress,
    undefined,
    `Testing all ${generated.possible.toLocaleString()} team combinations × ${QUICK_TRIALS} random quick trials`,
  )

  for (let index = 0; index < candidates.length; index++) {
    const candidate = candidates[index]
    const quickValues: number[] = []
    for (let trial = 0; trial < QUICK_TRIALS; trial++) {
      const threshold = estimateThreshold(
        candidate.loadout,
        [searchSeeds[trial % searchSeeds.length]],
        runtime,
        settings.maxFloor,
        undefined,
        3,
      )
      quickValues.push(threshold.estimate)
      candidate.trusted = candidate.trusted && threshold.trusted
      for (const ability of threshold.unsupported) candidate.unsupported.add(ability)
    }
    const sortedQuick = [...quickValues].sort((a, b) => a - b)
    candidate.quickAverage = sortedQuick.reduce((sum, value) => sum + value, 0) / Math.max(1, sortedQuick.length)
    candidate.quickEstimate = sortedQuick[Math.floor(sortedQuick.length / 2)] ?? 1
    candidate.quickBest = sortedQuick[sortedQuick.length - 1] ?? 1
    runtime.quickTested = index + 1
    if (index % 12 === 0 || index + 1 === candidates.length) {
      const best = [...candidates.slice(0, index + 1)].sort((a, b) =>
        b.quickEstimate - a.quickEstimate
        || b.quickAverage - a.quickAverage
        || b.quickBest - a.quickBest
        || b.heuristic - a.heuristic
      )[0]
      const currentBest = best ? {
        id: rankedId(best.loadout),
        loadout: best.loadout,
        metrics: metricStats([best.quickEstimate], best.trusted, best.unsupported),
        quickEstimate: best.quickEstimate,
      } : undefined
      emitProgress(runtime, 'quick', onProgress, currentBest)
    }
  }

  candidates.sort((a, b) =>
    b.quickEstimate - a.quickEstimate
    || b.quickAverage - a.quickAverage
    || b.quickBest - a.quickBest
    || b.heuristic - a.heuristic
  )
  const middleCandidateCap = exhaustiveQuick
    ? Math.max(settings.middleCandidateCap, SMALL_SEARCH_MIDDLE_CAP)
    : settings.middleCandidateCap
  candidates = candidates.slice(0, Math.min(middleCandidateCap, candidates.length))
  runtime.remainingCandidates = candidates.length
  emitProgress(runtime, 'middle', onProgress, undefined, 'Refining stronger candidates with shared seeds')

  for (let index = 0; index < candidates.length; index++) {
    const candidate = candidates[index]
    const threshold = estimateThreshold(candidate.loadout, searchSeeds.slice(0, 3), runtime, settings.maxFloor, candidate.quickEstimate, 4)
    candidate.middleEstimate = threshold.estimate
    candidate.trusted = candidate.trusted && threshold.trusted
    for (const ability of threshold.unsupported) candidate.unsupported.add(ability)
    if (index % 8 === 0 || index + 1 === candidates.length) {
      runtime.remainingCandidates = candidates.length - index - 1
      emitProgress(runtime, 'middle', onProgress)
    }
  }

  candidates.sort((a, b) => b.middleEstimate - a.middleEstimate || b.quickEstimate - a.quickEstimate)
  const orderCandidateCap = exhaustiveQuick ? SMALL_SEARCH_ORDER_CAP : 24
  const orderCandidates = candidates.slice(0, Math.min(orderCandidateCap, candidates.length))
  runtime.finalists = orderCandidates.length
  emitProgress(runtime, 'order', onProgress, undefined, 'Optimizing auras and card order')

  const optimized: Candidate[] = []
  for (let index = 0; index < orderCandidates.length; index++) {
    optimized.push(optimizeAuraAndOrder(orderCandidates[index], inventory, inventoryMap, runtime, settings.maxFloor, searchSeeds))
    runtime.finalists = orderCandidates.length - index - 1
    emitProgress(runtime, 'order', onProgress)
  }

  const rechecked = optimized.map((candidate) => {
    const threshold = estimateThreshold(candidate.loadout, searchSeeds.slice(0, 5), runtime, settings.maxFloor, candidate.middleEstimate, 4)
    candidate.middleEstimate = threshold.estimate
    candidate.trusted = candidate.trusted && threshold.trusted
    for (const ability of threshold.unsupported) candidate.unsupported.add(ability)
    return candidate
  }).sort((a, b) => b.middleEstimate - a.middleEstimate)

  const finalistCap = exhaustiveQuick
    ? Math.max(settings.finalistCap, SMALL_SEARCH_FINALIST_CAP)
    : settings.finalistCap
  const finalists = rechecked.slice(0, Math.min(finalistCap, rechecked.length))
  runtime.finalists = finalists.length
  runtime.fullySimulated = 0
  runtime.fullySimulatedTotal = finalists.length
  emitProgress(runtime, 'final', onProgress, undefined, 'Running final shared-seed measurements')

  const results: RankedTeam[] = []
  for (let index = 0; index < finalists.length; index++) {
    const candidate = finalists[index]
    const metrics = finalMetrics(candidate.loadout, candidate.middleEstimate, settings.finalSeedCount, searchSeeds, runtime, settings.maxFloor)
    results.push({ id: rankedId(candidate.loadout), loadout: candidate.loadout, metrics, quickEstimate: candidate.quickEstimate })
    runtime.fullySimulated = index + 1
    const best = [...results].sort(compareRankedTeams)[0]
    emitProgress(runtime, 'final', onProgress, best)
  }

  return results.sort(compareRankedTeams)
}

function bestOrderForReplacement(loadout: TeamLoadout, center: number, runtime: SearchRuntime, maxFloor: number, inventoryMap: Map<string, OwnedCard>, seeds: number[]): TeamLoadout {
  let best = loadout
  let bestScore = Number.NEGATIVE_INFINITY
  for (const order of validOrders(loadout.cards, inventoryMap)) {
    const candidate = { ...loadout, cards: order }
    const score = probeScore(candidate, center, runtime, maxFloor, seeds)
    if (score > bestScore) {
      bestScore = score
      best = candidate
    }
  }
  return best
}

export function searchReplacements(
  inventory: InventoryState,
  currentLoadout: TeamLoadout,
  slot: 0 | 1 | 2 | 3,
  settingsInput: Partial<SearchSettings> | undefined,
  onProgress: (progress: OptimizerProgress) => void,
): { baseline: TeamMetrics; results: ReplacementResult[] } {
  const settings = settingsWithDefaults(settingsInput)
  const searchSeeds = makeSearchSeeds(Math.max(SEARCH_SEED_POOL_SIZE, settings.finalSeedCount))
  if (currentLoadout.cards.length !== 4) throw new Error('Build a complete 4-card current deck first.')
  const { validCards } = validateInventory(inventory)
  const inventoryMap = new Map(validCards.map((card) => [cardVariantKey(card.cardName, card.borders), card] as const))
  const usedElsewhere = new Map<string, number>()
  currentLoadout.cards.forEach((card, index) => {
    if (index === slot) return
    const key = teamCardVariantKey(card)
    usedElsewhere.set(key, (usedElsewhere.get(key) ?? 0) + 1)
  })
  const currentKey = currentLoadout.cards[slot] ? teamCardVariantKey(currentLoadout.cards[slot]) : ''
  const choices = validCards.filter((card) => {
    const key = cardVariantKey(card.cardName, card.borders)
    return key !== currentKey && (usedElsewhere.get(key) ?? 0) < card.quantity
  })
  const runtime: SearchRuntime = {
    simulations: 0,
    possibleCombinations: choices.length,
    quickTested: 0,
    remainingCandidates: choices.length,
    finalists: choices.length,
    fullySimulated: 0,
    fullySimulatedTotal: choices.length,
  }

  const baselineCenter = initialFloorGuess(currentLoadout, settings.maxFloor)
  const baselineThreshold = estimateThreshold(currentLoadout, searchSeeds.slice(0, 5), runtime, settings.maxFloor, baselineCenter, 4)
  const baseline = finalMetrics(currentLoadout, baselineThreshold.estimate, Math.min(7, settings.finalSeedCount), searchSeeds, runtime, settings.maxFloor)
  emitProgress(runtime, 'replacement', onProgress, undefined, 'Testing replacements')

  const quick: Array<{ card: OwnedCard; loadout: TeamLoadout; estimate: number }> = []
  for (let index = 0; index < choices.length; index++) {
    const card = choices[index]
    const cardsForDeck = currentLoadout.cards.map((existing, existingIndex) => existingIndex === slot ? ownedCardToTeamCard(card) : existing)
    const base: TeamLoadout = { ...currentLoadout, cards: cardsForDeck }
    const ordered = bestOrderForReplacement(base, baseline.medianDepth, runtime, settings.maxFloor, inventoryMap, searchSeeds)
    const threshold = estimateThreshold(ordered, searchSeeds.slice(0, 3), runtime, settings.maxFloor, baseline.medianDepth, 3)
    quick.push({ card, loadout: ordered, estimate: threshold.estimate })
    runtime.quickTested = index + 1
    runtime.remainingCandidates = choices.length - index - 1
    if (index % 4 === 0 || index + 1 === choices.length) emitProgress(runtime, 'replacement', onProgress)
  }

  quick.sort((a, b) => b.estimate - a.estimate)
  const finalists = quick.slice(0, Math.min(12, quick.length))
  runtime.fullySimulatedTotal = finalists.length
  runtime.fullySimulated = 0
  const results: ReplacementResult[] = []
  for (let index = 0; index < finalists.length; index++) {
    const finalist = finalists[index]
    const metrics = finalMetrics(finalist.loadout, finalist.estimate, Math.min(7, settings.finalSeedCount), searchSeeds, runtime, settings.maxFloor)
    results.push({
      cardName: finalist.card.cardName,
      borders: canonicalBorders(finalist.card.borders),
      loadout: finalist.loadout,
      metrics,
      medianDelta: metrics.medianDepth - baseline.medianDepth,
    })
    runtime.fullySimulated = index + 1
    emitProgress(runtime, 'replacement', onProgress)
  }

  results.sort((a, b) => b.metrics.medianDepth - a.metrics.medianDepth)
  return { baseline, results }
}
