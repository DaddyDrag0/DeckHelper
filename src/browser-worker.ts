/// <reference lib="webworker" />

import { simulateDepthsRun, type DepthsRunResult } from './engine/simulation'
import { SeededRng } from './engine/rng'
import { auraPackRangeForMedian } from './engine/depths-rewards'
import { estimateDepthClearSeconds } from './engine/depths-time'
import type { TeamLoadout } from './types'

interface BatchRequest {
  kind?: 'batch'
  id: number
  loadout: TeamLoadout
  runs: number
  floorCap: number
  seed: number
}

interface SingleRunRequest {
  kind: 'single-run'
  id: number
  loadout: TeamLoadout
  floorCap: number
  batchSeed: number
  runIndex: number
}

type SimulationRequest = BatchRequest | SingleRunRequest

const STALL_WATCHDOG_MS = 20_000
const LIVE_BATTLE_TURN_CAP = 10_000

function runSeed(batchSeed: number, runIndex: number): number {
  const rng = new SeededRng(batchSeed)
  let seed = 1
  for (let index = 0; index <= runIndex; index++) {
    seed = Math.floor(rng.next() * 0x7fffffff) || index + 1
  }
  return seed
}

function summarize(results: DepthsRunResult[]) {
  const unsupported = new Set<string>()
  for (const result of results) {
    for (const ability of result.unsupportedAbilities) unsupported.add(ability)
  }
  const floors = results.map((result) => result.deathFloor).sort((a, b) => a - b)
  const middle = Math.floor(floors.length / 2)
  const medianFloor = floors.length % 2 ? floors[middle] : (floors[middle - 1] + floors[middle]) / 2
  const estimate = auraPackRangeForMedian(medianFloor)
  const totalBattles = results.reduce((sum, result) => sum + result.battles, 0)
  const totalTurns = results.reduce((sum, result) => sum + result.totalTurns, 0)
  const averageTurnsPerBattle = totalBattles > 0 ? totalTurns / totalBattles : 0
  const estimatedSecondsLow = estimateDepthClearSeconds(estimate.low, averageTurnsPerBattle, true)
  const estimatedSecondsMedian = estimateDepthClearSeconds(estimate.medianDepth, averageTurnsPerBattle, true)
  const estimatedSecondsHigh = estimateDepthClearSeconds(estimate.high, averageTurnsPerBattle, true)
  const auraCardsPerHour = estimatedSecondsMedian > 0 ? estimate.auraPackMedian / (estimatedSecondsMedian / 3600) : 0
  return {
    runs: results,
    averageFloor: floors.reduce((sum, floor) => sum + floor, 0) / floors.length,
    medianFloor,
    minFloor: floors[0],
    maxFloor: floors[floors.length - 1],
    estimatedFloorLow: estimate.low,
    estimatedFloorHigh: estimate.high,
    auraPackLow: estimate.auraPackLow,
    auraPackMedian: estimate.auraPackMedian,
    auraPackHigh: estimate.auraPackHigh,
    averageTurnsPerBattle,
    estimatedSecondsLow,
    estimatedSecondsMedian,
    estimatedSecondsHigh,
    auraCardsPerHour,
    trusted: unsupported.size === 0,
    unsupportedAbilities: [...unsupported].sort(),
  }
}

function simulateOne(request: SingleRunRequest, onProgress?: (floor: number, battleTurn?: number, enemyNames?: string[]) => void): DepthsRunResult {
  return simulateDepthsRun(request.loadout, {
    floorCap: request.floorCap,
    seed: runSeed(request.batchSeed, request.runIndex),
    battleTurnCap: LIVE_BATTLE_TURN_CAP,
    throwOnBattleTurnCap: false,
  }, onProgress)
}

async function simulateParallel(request: BatchRequest): Promise<DepthsRunResult[]> {
  const runs = Math.max(1, Math.floor(request.runs))
  const hardware = Math.max(1, Number(self.navigator.hardwareConcurrency) || 4)
  const workerCount = Math.min(runs, Math.max(1, Math.min(12, hardware - 1 || 1)))
  const results = new Array<DepthsRunResult>(runs)
  const workers: Worker[] = []
  const runFloors = new Array<number>(runs).fill(1)
  const runBattleTurns = new Array<number>(runs).fill(0)
  const activeRuns = new Set<number>()
  let nextRun = 0
  let completed = 0
  let settled = false

  return new Promise((resolve, reject) => {
    const stopAll = () => {
      for (const worker of workers) worker.terminate()
    }
    const fail = (error: Error) => {
      if (settled) return
      settled = true
      stopAll()
      reject(error)
    }
    const finishIfDone = () => {
      if (!settled && completed === runs) {
        settled = true
        stopAll()
        resolve(results)
      }
    }
    const dispatch = (worker: Worker) => {
      if (settled) return
      if (nextRun >= runs) {
        finishIfDone()
        return
      }

      const runIndex = nextRun++
      activeRuns.add(runIndex)
      let lastFloor = 1
      let lastBattleTurn = 0
      let lastEnemies: string[] = []
      let lastForwardedAt = 0
      let watchdog: ReturnType<typeof setTimeout> | null = null
      const armWatchdog = () => {
        if (watchdog) clearTimeout(watchdog)
        watchdog = setTimeout(() => {
          const turnText = lastBattleTurn > 0 ? ` around battle turn ${lastBattleTurn}` : ''
          const enemyText = lastEnemies.length ? ` vs ${lastEnemies.join(' | ')}` : ''
          fail(new Error(`Simulation stalled on run ${runIndex + 1}/${runs} near floor ${lastFloor}${turnText}${enemyText}. No simulation progress for ${STALL_WATCHDOG_MS / 1000}s. Batch seed ${request.seed}; run seed ${runSeed(request.seed, runIndex)}.`))
        }, STALL_WATCHDOG_MS)
      }
      armWatchdog()

      worker.onmessage = (event: MessageEvent) => {
        const message = event.data
        if (message?.kind === 'progress') {
          const nextFloorValue = Number(message.floor) || lastFloor
          const nextBattleTurn = Math.max(0, Number(message.battleTurn) || 0)
          if (Array.isArray(message.enemies)) lastEnemies = message.enemies.map(String)
          const floorAdvanced = nextFloorValue !== lastFloor
          const turnAdvanced = !floorAdvanced && nextBattleTurn > lastBattleTurn
          if (floorAdvanced) {
            lastFloor = nextFloorValue
            lastBattleTurn = nextBattleTurn
            armWatchdog()
          } else if (turnAdvanced) {
            lastBattleTurn = nextBattleTurn
            armWatchdog()
          }
          runFloors[runIndex] = lastFloor
          runBattleTurns[runIndex] = lastBattleTurn
          const activeFloorValues = [...activeRuns].map((index) => runFloors[index])
          const minActiveFloor = activeFloorValues.length ? Math.min(...activeFloorValues) : lastFloor
          const maxActiveFloor = activeFloorValues.length ? Math.max(...activeFloorValues) : lastFloor
          const now = performance.now()
          if (now - lastForwardedAt >= 100) {
            lastForwardedAt = now
            self.postMessage({
              kind: 'progress',
              id: request.id,
              completedRuns: completed,
              totalRuns: runs,
              runIndex,
              floor: lastFloor,
              battleTurn: lastBattleTurn || undefined,
              activeRuns: activeRuns.size,
              minActiveFloor,
              maxActiveFloor,
              enemies: lastEnemies,
            })
          }
          return
        }

        if (watchdog) clearTimeout(watchdog)
        if (!message?.ok) {
          fail(new Error(message?.error || 'Parallel simulation worker failed'))
          return
        }
        results[runIndex] = message.result
        runFloors[runIndex] = message.result?.deathFloor || lastFloor
        runBattleTurns[runIndex] = 0
        activeRuns.delete(runIndex)
        completed += 1
        const remainingFloors = [...activeRuns].map((index) => runFloors[index])
        self.postMessage({
          kind: 'progress',
          id: request.id,
          completedRuns: completed,
          totalRuns: runs,
          runIndex,
          floor: message.result?.deathFloor || lastFloor,
          activeRuns: activeRuns.size,
          minActiveFloor: remainingFloors.length ? Math.min(...remainingFloors) : undefined,
          maxActiveFloor: remainingFloors.length ? Math.max(...remainingFloors) : undefined,
        })
        dispatch(worker)
        finishIfDone()
      }
      worker.onerror = (event) => {
        if (watchdog) clearTimeout(watchdog)
        fail(new Error(event.message || 'Parallel simulation worker failed'))
      }
      worker.postMessage({
        kind: 'single-run',
        id: request.id,
        loadout: request.loadout,
        floorCap: request.floorCap,
        batchSeed: request.seed,
        runIndex,
      } satisfies SingleRunRequest)
    }

    try {
      for (let index = 0; index < workerCount; index++) {
        const worker = new Worker(self.location.href)
        workers.push(worker)
        dispatch(worker)
      }
    } catch (error) {
      fail(error instanceof Error ? error : new Error(String(error)))
    }
  })
}

self.onmessage = async (event: MessageEvent<SimulationRequest>) => {
  const request = event.data
  const started = performance.now()
  try {
    if (request.kind === 'single-run') {
      const result = simulateOne(request, (floor, battleTurn, enemyNames) => {
        self.postMessage({
          kind: 'progress',
          id: request.id,
          runIndex: request.runIndex,
          floor,
          battleTurn,
          enemies: enemyNames,
        })
      })
      self.postMessage({ id: request.id, ok: true, elapsedMs: performance.now() - started, result })
      return
    }
    const results = await simulateParallel(request)
    self.postMessage({ id: request.id, ok: true, elapsedMs: performance.now() - started, result: summarize(results) })
  } catch (error) {
    self.postMessage({
      id: request.id,
      ok: false,
      elapsedMs: performance.now() - started,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
