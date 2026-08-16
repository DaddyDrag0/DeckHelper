/// <reference lib="webworker" />

import type { WorkerInbound, WorkerOutbound } from './app-types'
import { searchBestTeams, searchReplacements } from './optimizer/search'

const worker = self as DedicatedWorkerGlobalScope

function send(message: WorkerOutbound) {
  worker.postMessage(message)
}

worker.onmessage = (event: MessageEvent<WorkerInbound>) => {
  if (!event.data || event.data.type !== 'run') return
  try {
    const request = event.data.request
    if (request.kind === 'search') {
      const results = searchBestTeams(request.inventory, request.settings, (progress) => {
        send({ type: 'progress', progress })
      })
      send({ type: 'search-result', results })
      return
    }

    const result = searchReplacements(
      request.inventory,
      request.currentLoadout,
      request.slot,
      request.settings,
      (progress) => send({ type: 'progress', progress }),
    )
    send({ type: 'replacement-result', baseline: result.baseline, results: result.results })
  } catch (error) {
    send({ type: 'error', message: error instanceof Error ? error.message : String(error) })
  }
}
