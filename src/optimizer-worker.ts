/// <reference lib="webworker" />

import type { WorkerInbound, WorkerOutbound } from './app-types'
import { searchBestTeams, searchReplacements, type ExactDepthsBatchRunner } from './optimizer/search'
import type { DepthsBatchResult } from './engine/simulation'

const worker = self as DedicatedWorkerGlobalScope

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

worker.onmessage = async (event: MessageEvent<WorkerInbound>) => {
  if (!event.data || event.data.type !== 'run') return
  try {
    const request = event.data.request
    if (request.kind === 'search') {
      const results = await searchBestTeams(request.inventory, request.settings, (progress) => {
        send({ type: 'progress', progress })
      }, runParallelDepthsBatch, request.bannedCardNames)
      send({ type: 'search-result', results })
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
