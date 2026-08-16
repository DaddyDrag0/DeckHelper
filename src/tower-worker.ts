/// <reference lib="webworker" />

import { simulateTowerBatch, type TowerDifficulty } from './engine/tower'
import type { TeamLoadout } from './types'

interface TowerSimulationRequest {
  id: number
  kind: 'tower-batch'
  loadout: TeamLoadout
  enemyNames: string[]
  floor: number
  difficulty: TowerDifficulty
  runs: number
  seed: number
}

self.onmessage = (event: MessageEvent<TowerSimulationRequest>) => {
  const request = event.data
  const started = performance.now()
  try {
    const result = simulateTowerBatch(
      request.loadout,
      request.enemyNames,
      request.floor,
      request.difficulty,
      request.runs,
      request.seed,
      (completed, total) => {
        self.postMessage({ kind: 'tower-progress', id: request.id, completed, total })
      },
    )
    self.postMessage({
      id: request.id,
      kind: 'tower-result',
      ok: true,
      elapsedMs: performance.now() - started,
      result,
    })
  } catch (error) {
    self.postMessage({
      id: request.id,
      kind: 'tower-result',
      ok: false,
      elapsedMs: performance.now() - started,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
