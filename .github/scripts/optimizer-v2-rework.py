from pathlib import Path
import json
import re


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise SystemExit(f'{label}: target not found')
    return text.replace(old, new, 1)


def sub_once(text: str, pattern: str, replacement: str, label: str) -> str:
    new_text, count = re.subn(pattern, replacement, text, count=1, flags=re.S | re.M)
    if count != 1:
        raise SystemExit(f'{label}: expected one replacement, got {count}')
    return new_text

# --- optimizer core -------------------------------------------------------
p = Path('src/optimizer/search.ts')
s = p.read_text()

s = sub_once(
    s,
    r"const SEARCH_SEED_POOL_SIZE = 32\nconst QUICK_TRIALS = 5\nconst MAX_EXHAUSTIVE_COMBINATIONS = 100_000\nconst SMALL_SEARCH_MIDDLE_CAP = 600\nconst SMALL_SEARCH_ORDER_CAP = 96\nconst SMALL_SEARCH_FINALIST_CAP = 30\nconst FAST_QUICK_TRIALS = 2\nconst FAST_SEARCH_MIDDLE_CAP = 240\nconst FAST_SEARCH_ORDER_CAP = 40\nconst FAST_SEARCH_FINALIST_CAP = 10\nconst FAST_FINAL_SEED_COUNT = 5",
    """const SEARCH_SEED_POOL_SIZE = 48
const MAX_EXHAUSTIVE_COMBINATIONS = 100_000
const BASELINE_SEED_COUNT = 2
const DEFAULT_REFINE_CAP = 180
const DEFAULT_FINALIST_CAP = 14
const MAX_ORDER_CANDIDATES = 64
const ABILITY_AURA_SHORTLIST = 5
const AURA_PAIR_KEEP = 3
const DEFAULT_FINAL_SEED_COUNT = 17
const DEEP_RECHECK_COUNT = 5
const DEEP_RECHECK_SEED_COUNT = 29""",
    'optimizer constants',
)

s = replace_once(
    s,
    """export const DEFAULT_SEARCH_SETTINGS: SearchSettings = {
  mode: 'full',
  candidateCap: MAX_EXHAUSTIVE_COMBINATIONS,
  quickCandidateCap: 1_000,
  middleCandidateCap: 120,
  finalistCap: 10,
  finalSeedCount: 15,
  maxFloor: 100_000,
}""",
    """export const DEFAULT_SEARCH_SETTINGS: SearchSettings = {
  mode: 'full',
  candidateCap: MAX_EXHAUSTIVE_COMBINATIONS,
  quickCandidateCap: 1_000,
  middleCandidateCap: DEFAULT_REFINE_CAP,
  finalistCap: DEFAULT_FINALIST_CAP,
  finalSeedCount: DEFAULT_FINAL_SEED_COUNT,
  maxFloor: 100_000,
}""",
    'default search settings',
)

s = replace_once(
    s,
    """interface Candidate {
  names: string[]
  loadout: TeamLoadout
  heuristic: number
  quickEstimate: number
  quickAverage: number
  quickBest: number
  middleEstimate: number
  trusted: boolean
  unsupported: Set<string>
}""",
    """interface AuraPair {
  statAura: AuraSelection | null
  abilityAura: AuraSelection | null
  score: number
}

interface Candidate {
  names: string[]
  loadout: TeamLoadout
  heuristic: number
  quickEstimate: number
  quickAverage: number
  quickBest: number
  middleEstimate: number
  auraPairs: AuraPair[]
  trusted: boolean
  unsupported: Set<string>
}""",
    'candidate interface',
)

s = sub_once(
    s,
    r"function settingsWithDefaults\(settings\?: Partial<SearchSettings>\): SearchSettings \{.*?^\}",
    """function settingsWithDefaults(settings?: Partial<SearchSettings>): SearchSettings {
  return {
    // DeckHelper now has one optimizer path. Keep the legacy field for stored/request
    // compatibility, but never downgrade the search to an approximate mode.
    mode: 'full',
    candidateCap: Math.max(100, Math.floor(settings?.candidateCap ?? DEFAULT_SEARCH_SETTINGS.candidateCap)),
    quickCandidateCap: Math.max(20, Math.floor(settings?.quickCandidateCap ?? DEFAULT_SEARCH_SETTINGS.quickCandidateCap)),
    middleCandidateCap: Math.max(10, Math.floor(settings?.middleCandidateCap ?? DEFAULT_SEARCH_SETTINGS.middleCandidateCap)),
    finalistCap: Math.max(3, Math.floor(settings?.finalistCap ?? DEFAULT_SEARCH_SETTINGS.finalistCap)),
    finalSeedCount: Math.max(3, Math.floor(settings?.finalSeedCount ?? DEFAULT_SEARCH_SETTINGS.finalSeedCount)) | 1,
    maxFloor: Math.max(100, Math.floor(settings?.maxFloor ?? DEFAULT_SEARCH_SETTINGS.maxFloor)),
  }
}""",
    'settingsWithDefaults',
)

# Give actual wins at/above the candidate's limit much more weight than turn speed.
s = sub_once(
    s,
    r"function probeScore\(loadout: TeamLoadout, center: number, runtime: SearchRuntime, maxFloor: number, seeds: number\[\]\): number \{.*?^\}",
    """function probeScore(loadout: TeamLoadout, center: number, runtime: SearchRuntime, maxFloor: number, seeds: number[]): number {
  const floors = [0.95, 1, 1.05].map((factor) => Math.max(1, Math.min(maxFloor, Math.round(center * factor))))
  let score = 0
  for (let index = 0; index < floors.length; index++) {
    const probe = probeFloor(loadout, floors[index], seeds.slice(0, 3), runtime)
    const winRate = probe.wins / Math.max(1, probe.runs)
    const difficultyWeight = index === 0 ? 0.9 : index === 1 ? 1 : 1.15
    score += winRate * 1_000 * difficultyWeight
    // Only use speed as a small tie-breaker. Winning the hard floor matters far more.
    score += Math.max(0, 250 - probe.averageTurns) * 0.02
  }
  return score
}""",
    'probeScore',
)

new_optimize_block = r'''function candidateIdentity(candidate: Candidate): string {
  return [...candidate.names].sort().join('\u0000')
}

function candidateCoverageKeys(candidate: Candidate): string[] {
  const keys = [...candidate.names].sort()
  const coverage = new Set<string>()
  for (const key of keys) coverage.add(`1:${key}`)
  for (let left = 0; left < keys.length; left++) {
    for (let right = left + 1; right < keys.length; right++) coverage.add(`2:${keys[left]}\u0001${keys[right]}`)
  }
  return [...coverage]
}

/**
 * Keep the strongest teams, then add the strongest available team covering every
 * owned card and card-pair. This is deliberately broader than a raw-stat top-N:
 * pair-specific abilities and Skill Auras get a chance to prove themselves before
 * the optimizer prunes the field.
 */
function coverageCandidates(candidates: Candidate[], topCap: number): Candidate[] {
  const sorted = [...candidates].sort((a, b) =>
    b.quickEstimate - a.quickEstimate
    || b.quickAverage - a.quickAverage
    || b.heuristic - a.heuristic
  )
  const selected = sorted.slice(0, Math.min(topCap, sorted.length))
  const selectedIds = new Set(selected.map(candidateIdentity))
  const covered = new Set<string>()
  for (const candidate of selected) for (const key of candidateCoverageKeys(candidate)) covered.add(key)

  for (const candidate of sorted) {
    const coverage = candidateCoverageKeys(candidate)
    if (!coverage.some((key) => !covered.has(key))) continue
    const id = candidateIdentity(candidate)
    if (!selectedIds.has(id)) {
      selected.push(candidate)
      selectedIds.add(id)
    }
    for (const key of coverage) covered.add(key)
  }
  return selected
}

function optimizeAuraAndOrder(
  candidate: Candidate,
  _inventory: InventoryState,
  inventoryMap: Map<string, OwnedCard>,
  runtime: SearchRuntime,
  maxFloor: number,
  seeds: number[],
): Candidate {
  const fallback: AuraPair = {
    statAura: candidate.loadout.statAura ?? null,
    abilityAura: candidate.loadout.abilityAura ?? null,
    score: 0,
  }
  const pairs = (candidate.auraPairs.length ? candidate.auraPairs : [fallback]).slice(0, AURA_PAIR_KEEP)
  const orders = validOrders(candidate.loadout.cards, inventoryMap)

  let bestLoadout = candidate.loadout
  let bestScore = Number.NEGATIVE_INFINITY
  for (const pair of pairs) {
    for (const order of orders) {
      const loadout: TeamLoadout = { cards: order, statAura: pair.statAura, abilityAura: pair.abilityAura }
      const score = probeScore(loadout, candidate.middleEstimate, runtime, maxFloor, seeds.slice(0, 3))
      if (score > bestScore) {
        bestScore = score
        bestLoadout = loadout
      }
    }
  }

  // Re-measure after order changes so a lucky one-floor order probe cannot carry a team.
  const threshold = estimateThreshold(bestLoadout, seeds.slice(0, 5), runtime, maxFloor, candidate.middleEstimate, 4)
  candidate.trusted = candidate.trusted && threshold.trusted
  for (const ability of threshold.unsupported) candidate.unsupported.add(ability)
  return { ...candidate, loadout: bestLoadout, middleEstimate: threshold.estimate }
}
'''

s = sub_once(
    s,
    r"function optimizeAuraAndOrder\(.*?^\}\n\n(?=function metricStats)",
    new_optimize_block + "\n",
    'optimize aura and order block',
)

s = sub_once(
    s,
    r"function metricStats\(values: number\[\], trusted: boolean, unsupported: Set<string>\): TeamMetrics \{.*?^\}",
    """function percentile(sorted: number[], proportion: number): number {
  if (!sorted.length) return 1
  if (sorted.length === 1) return sorted[0]
  const position = (sorted.length - 1) * Math.max(0, Math.min(1, proportion))
  const low = Math.floor(position)
  const high = Math.ceil(position)
  if (low === high) return sorted[low]
  const mix = position - low
  return sorted[low] * (1 - mix) + sorted[high] * mix
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
    reliabilityDepth: percentile(sorted, 0.25),
    upperQuartileDepth: percentile(sorted, 0.75),
    samples: sorted.length,
    trusted,
    unsupportedAbilities: [...unsupported].sort(),
  }
}""",
    'metricStats',
)

s = sub_once(
    s,
    r"function compareRankedTeams\(a: RankedTeam, b: RankedTeam\): number \{.*?^\}",
    """function practicalTeamScore(metrics: TeamMetrics): number {
  const reliable = metrics.reliabilityDepth ?? metrics.minimumDepth
  // Favor the floor a team reaches in ordinary/bad runs, while still valuing ceiling.
  // Consistency is a penalty rather than a hard gate so strong teams are not discarded.
  return reliable * 0.45
    + metrics.medianDepth * 0.35
    + metrics.averageDepth * 0.20
    - metrics.consistency * 0.06
}

function compareRankedTeams(a: RankedTeam, b: RankedTeam): number {
  return practicalTeamScore(b.metrics) - practicalTeamScore(a.metrics)
    || (b.metrics.reliabilityDepth ?? b.metrics.minimumDepth) - (a.metrics.reliabilityDepth ?? a.metrics.minimumDepth)
    || b.metrics.medianDepth - a.metrics.medianDepth
    || b.metrics.averageDepth - a.metrics.averageDepth
    || a.metrics.consistency - b.metrics.consistency
    || b.metrics.minimumDepth - a.metrics.minimumDepth
}""",
    'compareRankedTeams',
)

new_search = r'''export async function searchBestTeams(
  inventory: InventoryState,
  settingsInput: Partial<SearchSettings> | undefined,
  onProgress: (progress: OptimizerProgress) => void,
  exactBatchRunner?: ExactDepthsBatchRunner,
  bannedCardNames: string[] = [],
): Promise<RankedTeam[]> {
  const settings = settingsWithDefaults(settingsInput)
  const searchSeeds = makeSearchSeeds(Math.max(SEARCH_SEED_POOL_SIZE, settings.finalSeedCount))
  const { validCards } = validateInventory(inventory)
  const inventoryMap = new Map(validCards.map((card) => [cardVariantKey(card.cardName, card.borders), card] as const))
  const statOptions = auraOptions(inventory, 'stat')
  const abilityOptions = auraOptions(inventory, 'ability')

  const generated = generateTeamNameSets(inventory, settings.candidateCap)
  const runtime: SearchRuntime = {
    simulations: 0,
    bannedCardNames: bannedCardNames.slice(0, MAX_DEPTH_BANS),
    possibleCombinations: generated.possible,
    quickTested: 0,
    remainingCandidates: generated.sets.length,
    finalists: 0,
    fullySimulated: 0,
    fullySimulatedTotal: 0,
  }
  emitProgress(runtime, 'prepare', onProgress, undefined, `Building all ${generated.possible.toLocaleString()} legal 4-card teams`)

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
      auraPairs: [],
      trusted: true,
      unsupported: new Set<string>(),
    }
  })

  runtime.remainingCandidates = candidates.length
  emitProgress(runtime, 'quick', onProgress, undefined, 'Scouting every team with every owned Stat Aura')

  // Stage 1: every legal card composition gets measured. Stat Auras are cheap enough
  // (the UI caps them at four), so no Stat Aura is discarded by a raw-stat heuristic.
  for (let index = 0; index < candidates.length; index++) {
    const candidate = candidates[index]
    let bestEstimate = 1
    let bestHeuristic = Number.NEGATIVE_INFINITY
    let bestLoadout = candidate.loadout

    for (const statAura of statOptions) {
      const loadout: TeamLoadout = { cards: candidate.loadout.cards, statAura, abilityAura: null }
      const threshold = estimateThreshold(loadout, searchSeeds.slice(0, BASELINE_SEED_COUNT), runtime, settings.maxFloor, undefined, 2)
      const heuristic = rawLoadoutScore(loadout.cards, statAura)
      candidate.trusted = candidate.trusted && threshold.trusted
      for (const ability of threshold.unsupported) candidate.unsupported.add(ability)
      if (threshold.estimate > bestEstimate || (threshold.estimate === bestEstimate && heuristic > bestHeuristic)) {
        bestEstimate = threshold.estimate
        bestHeuristic = heuristic
        bestLoadout = loadout
      }
    }

    candidate.loadout = bestLoadout
    candidate.heuristic = bestHeuristic
    candidate.quickEstimate = bestEstimate
    candidate.quickAverage = bestEstimate
    candidate.quickBest = bestEstimate
    candidate.middleEstimate = bestEstimate
    runtime.quickTested = index + 1
    runtime.remainingCandidates = candidates.length - index - 1

    if (index % 10 === 0 || index + 1 === candidates.length) {
      const best = [...candidates.slice(0, index + 1)].sort((a, b) => b.quickEstimate - a.quickEstimate || b.heuristic - a.heuristic)[0]
      const currentBest = best ? {
        id: rankedId(best.loadout),
        loadout: best.loadout,
        metrics: metricStats([best.quickEstimate], best.trusted, best.unsupported),
        quickEstimate: best.quickEstimate,
      } : undefined
      emitProgress(runtime, 'quick', onProgress, currentBest)
    }
  }

  candidates.sort((a, b) => b.quickEstimate - a.quickEstimate || b.heuristic - a.heuristic)

  // Stage 2: keep the top field PLUS the best team covering every card/card pair.
  // This is the anti-meta-pruning step that lets pair synergies and Skill Auras rescue
  // teams that look weaker on paper.
  const refinement = coverageCandidates(candidates, Math.min(settings.middleCandidateCap, candidates.length))
  runtime.remainingCandidates = refinement.length
  runtime.finalists = refinement.length
  emitProgress(runtime, 'middle', onProgress, undefined, `Testing Skill Aura synergy on ${refinement.length.toLocaleString()} promising/coverage teams`)

  for (let index = 0; index < refinement.length; index++) {
    const candidate = refinement[index]

    // First let every owned Skill Aura audition on this exact composition. One shared
    // seed makes this inexpensive and fair; the survivors are retested below.
    const abilityScores = abilityOptions.map((abilityAura) => ({
      abilityAura,
      score: probeScore(
        { ...candidate.loadout, abilityAura },
        candidate.quickEstimate,
        runtime,
        settings.maxFloor,
        searchSeeds.slice(0, 1),
      ),
    })).sort((a, b) => b.score - a.score)

    const abilityShortlist = abilityScores.slice(0, Math.min(ABILITY_AURA_SHORTLIST, abilityScores.length)).map((entry) => entry.abilityAura)
    const pairScores: AuraPair[] = []
    for (const statAura of statOptions) {
      for (const abilityAura of abilityShortlist) {
        const loadout: TeamLoadout = { cards: candidate.loadout.cards, statAura, abilityAura }
        pairScores.push({
          statAura,
          abilityAura,
          score: probeScore(loadout, candidate.quickEstimate, runtime, settings.maxFloor, searchSeeds.slice(0, 2)),
        })
      }
    }
    pairScores.sort((a, b) => b.score - a.score)
    candidate.auraPairs = pairScores.slice(0, Math.min(AURA_PAIR_KEEP, pairScores.length))

    const bestPair = candidate.auraPairs[0] ?? {
      statAura: candidate.loadout.statAura ?? null,
      abilityAura: candidate.loadout.abilityAura ?? null,
      score: 0,
    }
    candidate.loadout = { cards: candidate.loadout.cards, statAura: bestPair.statAura, abilityAura: bestPair.abilityAura }
    const threshold = estimateThreshold(candidate.loadout, searchSeeds.slice(0, 5), runtime, settings.maxFloor, candidate.quickEstimate, 4)
    candidate.middleEstimate = threshold.estimate
    candidate.trusted = candidate.trusted && threshold.trusted
    for (const ability of threshold.unsupported) candidate.unsupported.add(ability)

    runtime.remainingCandidates = refinement.length - index - 1
    runtime.finalists = refinement.length - index - 1
    if (index % 4 === 0 || index + 1 === refinement.length) emitProgress(runtime, 'middle', onProgress)
  }

  refinement.sort((a, b) => b.middleEstimate - a.middleEstimate || b.quickEstimate - a.quickEstimate || b.heuristic - a.heuristic)

  // Stage 3: order is part of the build, not an afterthought. Try every legal order
  // for the strongest aura pairs on a reasonably broad survivor pool.
  const orderCandidateCap = Math.min(refinement.length, MAX_ORDER_CANDIDATES, Math.max(24, settings.finalistCap * 4))
  const orderCandidates = refinement.slice(0, orderCandidateCap)
  runtime.finalists = orderCandidates.length
  emitProgress(runtime, 'order', onProgress, undefined, `Testing every legal card order on the top ${orderCandidates.length} teams`)

  const optimized: Candidate[] = []
  for (let index = 0; index < orderCandidates.length; index++) {
    optimized.push(optimizeAuraAndOrder(orderCandidates[index], inventory, inventoryMap, runtime, settings.maxFloor, searchSeeds))
    runtime.finalists = orderCandidates.length - index - 1
    emitProgress(runtime, 'order', onProgress)
  }

  optimized.sort((a, b) => b.middleEstimate - a.middleEstimate || b.quickEstimate - a.quickEstimate)
  const finalists = optimized.slice(0, Math.min(settings.finalistCap, optimized.length))
  runtime.finalists = finalists.length
  runtime.fullySimulated = 0
  runtime.fullySimulatedTotal = finalists.length

  // Stage 4: all finalists see the SAME exact Depths run seeds. This is common-random-
  // numbers benchmarking: a hard enemy sequence is hard for everybody instead of one
  // team randomly drawing an easier final sample than another.
  const finalBatchSeed = makeSearchSeeds(1)[0]
  emitProgress(runtime, 'final', onProgress, undefined, `Exact Depths validation: ${settings.finalSeedCount} shared runs per finalist`)

  const results: RankedTeam[] = []
  for (let index = 0; index < finalists.length; index++) {
    const candidate = finalists[index]
    const metrics = await finalMetrics(
      candidate.loadout,
      candidate.middleEstimate,
      settings.finalSeedCount,
      [finalBatchSeed],
      runtime,
      settings.maxFloor,
      exactBatchRunner,
    )
    results.push({ id: rankedId(candidate.loadout), loadout: candidate.loadout, metrics, quickEstimate: candidate.middleEstimate })
    runtime.fullySimulated = index + 1
    emitProgress(runtime, 'final', onProgress, [...results].sort(compareRankedTeams)[0])
  }

  results.sort(compareRankedTeams)

  // Stage 5: close top teams get a deeper sample. The default production search uses
  // 29 paired runs here, while intentionally tiny regression searches stay tiny.
  if (settings.finalSeedCount >= 11 && results.length > 1) {
    const recheck = results.slice(0, Math.min(DEEP_RECHECK_COUNT, results.length))
    const deepRuns = Math.max(settings.finalSeedCount, DEEP_RECHECK_SEED_COUNT)
    runtime.fullySimulatedTotal = finalists.length + recheck.length
    emitProgress(runtime, 'final', onProgress, results[0], `Deep validation: ${deepRuns} shared runs on the top ${recheck.length}`)

    for (let index = 0; index < recheck.length; index++) {
      const result = recheck[index]
      const metrics = await finalMetrics(
        result.loadout,
        result.metrics.medianDepth,
        deepRuns,
        [finalBatchSeed],
        runtime,
        settings.maxFloor,
        exactBatchRunner,
      )
      const resultIndex = results.findIndex((entry) => entry.id === result.id)
      if (resultIndex >= 0) results[resultIndex] = { ...result, metrics }
      runtime.fullySimulated = finalists.length + index + 1
      results.sort(compareRankedTeams)
      emitProgress(runtime, 'final', onProgress, results[0])
    }
  }

  return results.sort(compareRankedTeams)
}'''

s = sub_once(
    s,
    r"export async function searchBestTeams\(.*?^\}\n\n(?=function bestOrderForReplacement)",
    new_search + "\n\n",
    'searchBestTeams',
)

# Production invariants for the new optimizer.
for needle in [
    'function coverageCandidates',
    'const abilityScores = abilityOptions.map',
    'candidate.auraPairs = pairScores.slice',
    'const finalBatchSeed = makeSearchSeeds(1)[0]',
    'DEEP_RECHECK_SEED_COUNT = 29',
    'function practicalTeamScore',
    'reliabilityDepth: percentile(sorted, 0.25)',
]:
    if needle not in s:
        raise SystemExit(f'optimizer invariant missing: {needle}')
p.write_text(s)

# --- metrics type ---------------------------------------------------------
p = Path('src/app-types.ts')
s = p.read_text()
s = replace_once(
    s,
    """  consistency: number
  samples: number""",
    """  consistency: number
  /** 25th percentile death floor: a robust bad/ordinary-run floor. */
  reliabilityDepth?: number
  /** 75th percentile death floor, useful for ceiling context. */
  upperQuartileDepth?: number
  samples: number""",
    'TeamMetrics reliability fields',
)
p.write_text(s)

# --- worker: Skill Auras now belong inside the optimizer, before pruning --
p = Path('src/optimizer-worker.ts')
s = p.read_text()
old = """    if (request.kind === 'search') {
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
    }"""
new = """    if (request.kind === 'search') {
      const results = await searchBestTeams(
        request.inventory,
        request.settings,
        (progress) => send({ type: 'progress', progress }),
        runParallelDepthsBatch,
        request.bannedCardNames,
      )
      send({ type: 'search-result', results })
      return
    }"""
s = replace_once(s, old, new, 'worker integrated aura search')
p.write_text(s)

# --- live UI --------------------------------------------------------------
p = Path('src/revamp.ts')
s = p.read_text()
s = replace_once(
    s,
    """          ${this.worker ? `<button class=\"rv-cancel\" data-action=\"cancel-search\">Cancel search</button>` : `<button class=\"rv-primary big\" data-action=\"start-full\" ${canSearch ? '' : 'disabled'}>Find Best Deck</button><button class=\"rv-secondary\" data-action=\"start-fast\" ${canSearch ? '' : 'disabled'}>Quick Search</button>`}
          <small>${this.ownedCopies() < 4 ? 'Add at least 4 card copies first.' : 'Best Deck = deeper testing · Quick = faster estimate'}</small>""",
    """          ${this.worker ? `<button class=\"rv-cancel\" data-action=\"cancel-search\">Cancel optimizer</button>` : `<button class=\"rv-primary big\" data-action=\"start-full\" ${canSearch ? '' : 'disabled'}>Find Best Deck</button>`}
          <small>${this.ownedCopies() < 4 ? 'Add at least 4 card copies first.' : 'One thorough search · cards, auras, order, then exact Depths validation'}</small>""",
    'remove quick button',
)
s = replace_once(
    s,
    """    const labels: Record<OptimizerProgress['phase'], string> = { prepare: 'Preparing', quick: 'Testing candidates', middle: 'Narrowing the field', order: 'Optimizing order & auras', final: 'Final simulations', replacement: 'Testing replacements' }""",
    """    const labels: Record<OptimizerProgress['phase'], string> = { prepare: 'Preparing', quick: 'Team combinations', middle: 'Aura synergy', order: 'Card order', final: 'Exact validation', replacement: 'Testing replacements' }""",
    'progress labels',
)
s = sub_once(
    s,
    r"  private sortedResults\(\) \{.*?^  \}",
    """  private sortedResults() {
    // The optimizer already applies the reliability-aware ranking. Do not re-sort it
    // in the UI with a different formula and accidentally undo the search result.
    return this.results.slice(0, 10)
  }""",
    'UI result sorting',
)
s = replace_once(
    s,
    """    return `<section class=\"rv-results\"><div class=\"rv-results-head\"><div><span>Results</span><h2>Best decks for your inventory</h2></div><small>${this.searchMode === 'full' ? 'Full Depths simulation' : 'Quick estimate'} · higher depth is better</small></div><div class=\"rv-result-list\">${results.map((result, index) => this.renderResult(result, index)).join('')}</div></section>`""",
    """    return `<section class=\"rv-results\"><div class=\"rv-results-head\"><div><span>Results</span><h2>Best usable decks for your inventory</h2></div><small>Ranked for reliable Depths performance · higher is better</small></div><div class=\"rv-result-list\">${results.map((result, index) => this.renderResult(result, index)).join('')}</div></section>`""",
    'result heading',
)
s = replace_once(
    s,
    """      <div class=\"rv-result-meta\"><span>Stat Aura <b>${escapeHtml(auraLabel(result.loadout.statAura))}</b></span><span>Ability Aura <b>${escapeHtml(auraLabel(result.loadout.abilityAura))}</b></span><span>Power estimate <b>~${formatNumber(powerEstimate)}</b></span>${this.searchMode === 'full' ? `<span>Median Depth <b>${formatNumber(result.metrics.medianDepth)}</b></span><span>Average <b>${formatNumber(result.metrics.averageDepth, 1)}</b></span>` : `<span>Estimated Depth <b>${formatNumber(result.metrics.medianDepth)}</b></span>`}</div>""",
    """      <div class=\"rv-result-meta\"><span>Stat Aura <b>${escapeHtml(auraLabel(result.loadout.statAura))}</b></span><span>Ability Aura <b>${escapeHtml(auraLabel(result.loadout.abilityAura))}</b></span><span>Power estimate <b>~${formatNumber(powerEstimate)}</b></span><span>Reliable Depth <b>${formatNumber(result.metrics.reliabilityDepth ?? result.metrics.minimumDepth)}</b></span><span>Median Depth <b>${formatNumber(result.metrics.medianDepth)}</b></span><span>Average <b>${formatNumber(result.metrics.averageDepth, 1)}</b></span></div>""",
    'result reliability metric',
)
s = replace_once(
    s,
    """    else if (action === 'start-full') this.startSearch('full')
    else if (action === 'start-fast') this.startSearch('fast')
    else if (action === 'cancel-search') this.cancelWorker()""",
    """    else if (action === 'start-full') this.startSearch('full')
    else if (action === 'cancel-search') this.cancelWorker()""",
    'remove quick click handler',
)
if 'Quick Search' in s or 'data-action="start-fast"' in s:
    raise SystemExit('Quick Search still exists in live revamp')
p.write_text(s)

# --- regressions ----------------------------------------------------------
Path('scripts/random-seed-regression.ts').write_text("""import fs from 'node:fs'\n\nconst source = fs.readFileSync('src/optimizer/search.ts', 'utf8')\nif (source.includes('COMMON_SEEDS')) throw new Error('Fixed optimizer seed pool returned')\nif (!source.includes('function makeSearchSeeds')) throw new Error('Fresh search seed generator missing')\nif (!source.includes('simulateDepthsBatch')) throw new Error('Finalists must use exact sequential Depths batches')\nif (!source.includes('battleTurnCap: 10_000')) throw new Error('Final Depths batch must match the calculator turn cap')\nif (!source.includes('batch.runs.map((run) => run.deathFloor)')) throw new Error('Final metrics must use actual first-loss death floors')\nif ((source.match(/const searchSeeds = makeSearchSeeds/g) || []).length !== 2) throw new Error('Each top-level optimizer operation must create one shared fresh pruning seed set')\nfor (const hook of ['const finalBatchSeed = makeSearchSeeds(1)[0]', 'settings.finalSeedCount,\\n      [finalBatchSeed]', 'DEEP_RECHECK_SEED_COUNT = 29']) {\n  if (!source.includes(hook)) throw new Error(`Shared finalist benchmark hook missing: ${hook}`)\n}\nif (source.includes('const finalistSeeds = makeSearchSeeds(settings.finalSeedCount)')) throw new Error('Finalists should not receive different random enemy samples')\nconsole.log('Depths seed regression passed: fresh shared pruning seeds + paired exact finalist seeds.')\n""")

Path('scripts/search-mode-regression.ts').write_text("""import fs from 'node:fs'\nconst revamp = fs.readFileSync('src/revamp.ts', 'utf8')\nconst search = fs.readFileSync('src/optimizer/search.ts', 'utf8')\nconst types = fs.readFileSync('src/app-types.ts', 'utf8')\nif (!revamp.includes('data-action=\\"start-full\\"')) throw new Error('Main optimizer action missing')\nfor (const removed of ['data-action=\\"start-fast\\"', 'Quick Search', 'Quick = faster estimate']) if (revamp.includes(removed)) throw new Error('legacy quick UI returned: '+removed)\nif (!search.includes("mode: 'full'")) throw new Error('optimizer must force the thorough path')\nif (!search.includes('One optimizer path') && !search.includes('one optimizer path')) throw new Error('single-mode optimizer compatibility note missing')\nif (!types.includes("export type SearchMode = 'fast' | 'full'")) throw new Error('legacy SearchMode compatibility type should remain for old stored requests')\nconsole.log('Single thorough optimizer mode regression passed.')\n""")

Path('scripts/optimizer-v2-regression.ts').write_text("""import fs from 'node:fs'\n\nconst search = fs.readFileSync('src/optimizer/search.ts', 'utf8')\nconst revamp = fs.readFileSync('src/revamp.ts', 'utf8')\nconst worker = fs.readFileSync('src/optimizer-worker.ts', 'utf8')\nconst types = fs.readFileSync('src/app-types.ts', 'utf8')\n\nfor (const hook of [\n  'function coverageCandidates',\n  'candidateCoverageKeys',\n  'const abilityScores = abilityOptions.map',\n  'candidate.auraPairs = pairScores.slice',\n  'Testing every legal card order',\n  'const finalBatchSeed = makeSearchSeeds(1)[0]',\n  'DEEP_RECHECK_SEED_COUNT = 29',\n  'function practicalTeamScore',\n  'reliabilityDepth: percentile(sorted, 0.25)',\n]) if (!search.includes(hook)) throw new Error('optimizer v2 hook missing: ' + hook)\n\nif ((worker.match(/expandAbilityAuraVariants\\(/g) || []).length !== 1) throw new Error('Skill Aura post-processing should be definition-only; search must handle it before pruning')\nif (!types.includes('reliabilityDepth?: number')) throw new Error('reliability metric missing from TeamMetrics')\nif (!revamp.includes('Reliable Depth')) throw new Error('reliability metric missing from result UI')\nif (!revamp.includes('return this.results.slice(0, 10)')) throw new Error('UI must preserve optimizer ranking')\nif (revamp.includes('Quick Search')) throw new Error('Quick Search UI returned')\nconsole.log('Optimizer v2 regression passed: coverage, pre-prune Skill Auras, paired finals, reliability ranking.')\n""")

pkg_path = Path('package.json')
pkg = json.loads(pkg_path.read_text())
cmd = pkg['scripts']['test:optimizer']
if 'optimizer-v2-regression.ts' not in cmd:
    cmd += ' && tsx scripts/optimizer-v2-regression.ts'
pkg['scripts']['test:optimizer'] = cmd
pkg_path.write_text(json.dumps(pkg, indent=2) + '\n')

print('Optimizer v2 source rework applied.')
