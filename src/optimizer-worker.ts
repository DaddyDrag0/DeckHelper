/// <reference lib="webworker" />

import auras from './data/auras'
import {
  auraSelection,
  type InventoryState,
  type OptimizerProgress,
  type RankedTeam,
  type SearchSettings,
  type TeamMetrics,
  type WorkerInbound,
  type WorkerOutbound,
} from './app-types'
import { searchBestTeams, searchReplacements, type ExactDepthsBatchRunner } from './optimizer/search'
import type { DepthsBatchResult } from './engine/simulation'
import type { AuraSelection, TeamLoadout } from './types'

const worker = self as DedicatedWorkerGlobalScope
const VALID_AURA_NAMES = new Set(auras.map((aura) => aura.name))
const FULL_AURA_DECK_LIMIT = 5
const FAST_AURA_DECK_LIMIT = 3
const AURA_QUICK_RUNS = 3
const MAX_EXTRA_AURA_VARIANTS_PER_DECK = 2
const EXTRA_AURA_CLOSE_RATIO = 0.9

function send(message: WorkerOutbound) {
  worker.postMessage(message)
}

let batchRequestId = 0

const runParallelDepthsBatch: ExactDepthsBatchRunner = (loadout, options) => new Promise<DepthsBatchResult>((resolve, reject) => {
  const id = ++batchRequestId
  let settled = false
  const batchWorker = new Worker(new URL('./browser-worker.ts', import.meta.url), { type: 'module' })
  const finish = () => batchWorker.terminate()

  batchWorker.onmessage = (event: MessageEvent) => {
    const message = event.data
    if (message?.kind === 'progress' || message?.id !== id) return
    if (settled) return
    settled = true
    finish()
    if (message?.ok) resolve(message.result as DepthsBatchResult)
    else reject(new Error(message?.error || 'Parallel Depths batch worker failed'))
  }
  batchWorker.onerror = (event) => {
    if (settled) return
    settled = true
    finish()
    reject(new Error(event.message || 'Parallel Depths batch worker failed'))
  }
  batchWorker.postMessage({
    id,
    loadout,
    runs: Math.max(1, Math.floor(options.runs ?? 15)),
    floorCap: Math.max(1, Math.floor(options.floorCap ?? 50_000)),
    seed: options.seed ?? 1,
    bannedCardNames: options.bannedCardNames,
  })
})

function abilityAuraKey(aura: AuraSelection | null | undefined): string {
  return aura ? `${aura.auraName}:${aura.border || 'Base'}` : '-'
}

function abilityAuraOptions(inventory: InventoryState): Array<AuraSelection | null> {
  const locked = inventory.abilityAuras.filter((aura) => aura.locked)
  const source = locked.length === 1 ? locked : inventory.abilityAuras
  const options: Array<AuraSelection | null> = locked.length === 1 ? [] : [null]

  for (const aura of source) {
    if (!VALID_AURA_NAMES.has(aura.auraName)) continue
    const borders = aura.borders.length ? aura.borders : ['Base' as const]
    for (const border of borders) options.push(auraSelection(aura.auraName, border))
  }

  const seen = new Set<string>()
  return options.filter((option) => {
    const key = abilityAuraKey(option)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function rankedId(loadout: TeamLoadout): string {
  const cardsKey = loadout.cards.map((card) => `${card.cardName}:${card.borders.join('+')}`).join('|')
  const stat = loadout.statAura ? `${loadout.statAura.auraName}:${loadout.statAura.border || 'Base'}` : '-'
  const ability = abilityAuraKey(loadout.abilityAura)
  return `${cardsKey}::${stat}::${ability}`
}

function compareRankedTeams(a: RankedTeam, b: RankedTeam): number {
  return b.metrics.medianDepth - a.metrics.medianDepth
    || b.metrics.averageDepth - a.metrics.averageDepth
    || b.metrics.minimumDepth - a.metrics.minimumDepth
    || a.metrics.consistency - b.metrics.consistency
    || b.metrics.maximumDepth - a.metrics.maximumDepth
}

function metricsFromBatch(batch: DepthsBatchResult): TeamMetrics {
  const values = batch.runs.map((run) => run.deathFloor)
  const average = values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length)
  const variance = values.reduce((sum, value) => sum + Math.pow(value - average, 2), 0) / Math.max(1, values.length)
  return {
    averageDepth: batch.averageFloor,
    medianDepth: batch.medianFloor,
    minimumDepth: batch.minFloor,
    maximumDepth: batch.maxFloor,
    consistency: Math.sqrt(variance),
    samples: batch.runs.length,
    trusted: batch.trusted,
    unsupportedAbilities: [...batch.unsupportedAbilities].sort(),
  }
}

function freshSeed(): number {
  const values = new Uint32Array(1)
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(values)
    if (values[0]) return values[0]
  }
  return ((Date.now() ^ Math.floor(Math.random() * 0xffff_ffff)) >>> 0) || 1
}

async function expandAbilityAuraVariants(
  baseResults: RankedTeam[],
  inventory: InventoryState,
  settings: Partial<SearchSettings> | undefined,
  bannedCardNames: string[] | undefined,
  onStatus: (message: string) => void,
): Promise<RankedTeam[]> {
  const options = abilityAuraOptions(inventory)
  if (baseResults.length === 0 || options.length <= 1) return baseResults

  const fastMode = settings?.mode === 'fast'
  const deckLimit = Math.min(baseResults.length, fastMode ? FAST_AURA_DECK_LIMIT : FULL_AURA_DECK_LIMIT)
  const floorCap = Math.max(100, Math.floor(settings?.maxFloor ?? 100_000))
  const defaultFinalRuns = fastMode ? 5 : 15
  const finalRuns = Math.max(3, Math.floor(settings?.finalSeedCount ?? defaultFinalRuns)) | 1
  const bans = (bannedCardNames ?? []).slice(0, 10)
  const alternates: RankedTeam[] = []

  for (let deckIndex = 0; deckIndex < deckLimit; deckIndex++) {
    const base = baseResults[deckIndex]
    const baseAuraKey = abilityAuraKey(base.loadout.abilityAura)
    const alternateOptions = options.filter((option) => abilityAuraKey(option) !== baseAuraKey)
    if (!alternateOptions.length) continue

    onStatus(`Comparing Ability Auras on deck ${deckIndex + 1}/${deckLimit}`)
    const quickSeed = freshSeed()
    const quickAlternates: RankedTeam[] = []

    for (const abilityAura of alternateOptions) {
      const loadout: TeamLoadout = { ...base.loadout, abilityAura }
      const batch = await runParallelDepthsBatch(loadout, {
        runs: AURA_QUICK_RUNS,
        floorCap,
        seed: quickSeed,
        bannedCardNames: bans,
      })
      quickAlternates.push({
        id: rankedId(loadout),
        loadout,
        metrics: metricsFromBatch(batch),
        quickEstimate: base.quickEstimate,
      })
    }

    quickAlternates.sort(compareRankedTeams)
    const bestQuick = quickAlternates[0]
    if (!bestQuick) continue
    const selected = quickAlternates
      .filter((result, index) => index === 0 || result.metrics.medianDepth >= bestQuick.metrics.medianDepth * EXTRA_AURA_CLOSE_RATIO)
      .slice(0, MAX_EXTRA_AURA_VARIANTS_PER_DECK)

    if (fastMode) {
      alternates.push(...selected)
      continue
    }

    for (const selectedAlternate of selected) {
      const batch = await runParallelDepthsBatch(selectedAlternate.loadout, {
        runs: finalRuns,
        floorCap,
        seed: freshSeed(),
        bannedCardNames: bans,
      })
      alternates.push({
        ...selectedAlternate,
        metrics: metricsFromBatch(batch),
      })
    }
  }

  if (!alternates.length) return baseResults

  const unique = new Map<string, RankedTeam>()
  for (const result of [...baseResults, ...alternates]) {
    const current = unique.get(result.id)
    if (!current || compareRankedTeams(result, current) < 0) unique.set(result.id, result)
  }

  return [...unique.values()].sort(compareRankedTeams).slice(0, baseResults.length)
}

worker.onmessage = async (event: MessageEvent<WorkerInbound>) => {
  if (!event.data || event.data.type !== 'run') return
  try {
    const request = event.data.request
    if (request.kind === 'search') {
      let lastProgress: OptimizerProgress | undefined
      const results = await searchBestTeams(request.inventory, request.settings, (progress) => {
        lastProgress = progress
        send({ type: 'progress', progress })
      }, runParallelDepthsBatch, request.bannedCardNames)

      const expandedResults = await expandAbilityAuraVariants(
        results,
        request.inventory,
        request.settings,
        request.bannedCardNames,
        (message) => {
          if (!lastProgress) return
          send({ type: 'progress', progress: { ...lastProgress, phase: 'final', message } })
        },
      )
      send({ type: 'search-result', results: expandedResults })
      return
    }

    const result = await searchReplacements(
      request.inventory,
      request.currentLoadout,
      request.slot,
      request.settings,
      (progress) => send({ type: 'progress', progress }),
      runParallelDepthsBatch,
      request.bannedCardNames,
    )
    send({ type: 'replacement-result', baseline: result.baseline, results: result.results })
  } catch (error) {
    send({ type: 'error', message: error instanceof Error ? error.message : String(error) })
  }
}
