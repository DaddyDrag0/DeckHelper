import type { AuraBorderName, AuraSelection, BorderName, TeamLoadout } from './types'

export type DeckSlot = 0 | 1 | 2 | 3
export type AuraOwnedBorder = 'Base' | AuraBorderName

export interface OwnedCard {
  cardName: string
  borders: BorderName[]
  locked: boolean
  lockedPosition: DeckSlot | null
}

export interface OwnedAura {
  auraName: string
  borders: AuraOwnedBorder[]
  locked: boolean
}

export interface InventoryState {
  cards: OwnedCard[]
  statAuras: OwnedAura[]
  abilityAuras: OwnedAura[]
}

export interface SavedDeck {
  id: string
  name: string
  loadout: TeamLoadout
  createdAt: number
}

export interface AppState {
  inventory: InventoryState
  favorites: SavedDeck[]
  currentDeck: TeamLoadout
}

export interface TeamMetrics {
  averageDepth: number
  medianDepth: number
  minimumDepth: number
  maximumDepth: number
  consistency: number
  samples: number
  trusted: boolean
  unsupportedAbilities: string[]
}

export interface RankedTeam {
  id: string
  loadout: TeamLoadout
  metrics: TeamMetrics
  quickEstimate?: number
}

export interface ReplacementResult {
  cardName: string
  loadout: TeamLoadout
  metrics: TeamMetrics
  medianDelta: number
}

export interface SearchSettings {
  candidateCap: number
  quickCandidateCap: number
  middleCandidateCap: number
  finalistCap: number
  finalSeedCount: number
  maxFloor: number
}

export interface OptimizerProgress {
  phase: 'prepare' | 'quick' | 'middle' | 'order' | 'final' | 'replacement'
  possibleCombinations: number
  quickTested: number
  remainingCandidates: number
  finalists: number
  fullySimulated: number
  fullySimulatedTotal: number
  simulations: number
  currentBest?: RankedTeam
  message?: string
}

export interface SearchRequest {
  kind: 'search'
  inventory: InventoryState
  settings?: Partial<SearchSettings>
}

export interface ReplacementRequest {
  kind: 'replacement'
  inventory: InventoryState
  currentLoadout: TeamLoadout
  slot: DeckSlot
  settings?: Partial<SearchSettings>
}

export type OptimizerRequest = SearchRequest | ReplacementRequest

export type WorkerInbound = { type: 'run'; request: OptimizerRequest }
export type WorkerOutbound =
  | { type: 'progress'; progress: OptimizerProgress }
  | { type: 'search-result'; results: RankedTeam[] }
  | { type: 'replacement-result'; baseline: TeamMetrics; results: ReplacementResult[] }
  | { type: 'error'; message: string }

export function auraSelection(auraName: string, border: AuraOwnedBorder): AuraSelection {
  return { auraName, border: border === 'Base' ? null : border }
}
