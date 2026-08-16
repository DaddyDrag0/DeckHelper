import { simulateBattleV2 } from '../src/engine/battle-v2'
import type { DepthsEnemy } from '../src/types'
import cards from '../src/data/cards'

function card(name: string) {
  const found = cards.find((c) => c.name === name)
  if (!found) throw new Error('Missing card: ' + name)
  return found
}

const shen = card('Shén Lóng')
const enemies: DepthsEnemy[] = [
  { card: shen, power: 1000, attack: 500, health: 1000 },
]
const result = simulateBattleV2({ cards: [{ cardName: 'Fuxi', borders: [] }] }, enemies, 17, 20, true, true)
const firstTurn = result.debug?.events.find((e) => e.type === 'turn')
if (!firstTurn?.detail.includes('defender 1000/1000 HP 500 ATK')) {
  throw new Error('Order of the Cosmos failed to suppress Shén Lóng entry ability: ' + (firstTurn?.detail || 'no turn event'))
}
console.log('Order of the Cosmos regression passed.')
