import cards from '../src/data/cards'
import { simulateBattleV2 } from '../src/engine/battle-v2'
import { simulateDepthsBatch } from '../src/engine/simulation'
import type { DepthsEnemy, TeamLoadout } from '../src/types'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function card(name: string) {
  const found = cards.find((entry) => entry.name === name)
  if (!found) throw new Error(`Missing regression card: ${name}`)
  return found
}

// Erosion should not make a passive-modified normal attack nonlethal.
const marrowEnemy: DepthsEnemy[] = [{ card: card('Marrowclaw'), power: 100, attack: 50, health: 100 }]
const malikBattle = simulateBattleV2(
  { cards: [{ cardName: 'Malik The Sovereign', borders: ['Galaxy'] }] },
  marrowEnemy,
  111,
  100,
  true,
)
assert(malikBattle.winner === 'Allies', `Malik should normally kill Marrowclaw; got ${malikBattle.winner} at T${malikBattle.turns}`)
assert(malikBattle.turns <= 3, `Marrowclaw normal-attack regression took ${malikBattle.turns} turns`)
console.log('Erosion normal-attack regression passed:', malikBattle.turns, 'turns')

// Zombie Dragon's two-turn survival must expire on global combat turns even if
// the opponent chains extra turns and Zombie Dragon never gets to act.
const zombieEnemy: DepthsEnemy[] = [{ card: card('Zombie Dragon'), power: 100, attack: 50, health: 100 }]
const zombieBattle = simulateBattleV2(
  { cards: [{ cardName: 'Priest', borders: ['Galaxy'] }] },
  zombieEnemy,
  222,
  100,
  true,
)
assert(zombieBattle.winner === 'Allies', `Zombie Dragon global lifespan failed; got ${zombieBattle.winner} at T${zombieBattle.turns}`)
assert(zombieBattle.turns < 20, `Zombie Dragon remained alive too long: ${zombieBattle.turns} turns`)
console.log('Zombie Dragon global-turn regression passed:', zombieBattle.turns, 'turns')

// Pandora intentionally draws from the full supported card pool, including limited-card abilities.
// The older limited-only exclusion regression was removed because it contradicted the current engine contract.

// Storm Spirit must not jump to the next enemy after a lethal primary attack.
const stormKillLoadout: TeamLoadout = {
  cards: [{ cardName: 'Titan', borders: ['Galaxy'] }],
  abilityAura: { auraName: 'Storm Spirit', border: 'Galaxy' },
}
const stormKillEnemies: DepthsEnemy[] = [
  { card: card('Wizard'), power: 1, attack: 0, health: 1 },
  { card: card('Wizard'), power: 1, attack: 0, health: 1 },
]
for (let seed = 1; seed <= 40; seed++) {
  const battle = simulateBattleV2(stormKillLoadout, stormKillEnemies, seed, 20, true, true)
  const badProc = battle.debug.events.some((event) => event.detail?.includes('Storm Spirit triggered'))
  assert(!badProc, `Storm Spirit incorrectly proc'd after a killing primary hit on seed ${seed}`)
}

// It must still proc when the original target survives the primary attack.
const stormSurviveEnemy: DepthsEnemy[] = [{ card: card('Titan'), power: 1_000_000_000, attack: 0, health: 1_000_000_000 }]
let sawStormProc = false
for (let seed = 1; seed <= 80 && !sawStormProc; seed++) {
  const battle = simulateBattleV2(stormKillLoadout, stormSurviveEnemy, seed, 1, true, true)
  sawStormProc = battle.debug.events.some((event) => event.detail?.includes('Storm Spirit triggered'))
}
assert(sawStormProc, 'Storm Spirit should still proc when the primary target survives')
console.log('Storm Spirit kill-gate regression passed')

// Live-game quirk: Horned Attack overkill can kill Parallax in slot 2 without
// Paradox retaliating into Triceratops.
const triceratopsBattle = simulateBattleV2(
  { cards: [{ cardName: 'Triceratops', borders: [] }] },
  [
    { card: card('Wizard'), power: 10, attack: 0, health: 10 },
    { card: card('Parallax'), power: 10, attack: 0, health: 10 },
  ],
  777,
  20,
  true,
  true,
)
assert(triceratopsBattle.winner === 'Allies', `Triceratops overkill should bypass Paradox; got ${triceratopsBattle.winner}`)
assert(triceratopsBattle.state.teams.Allies.some((entry) => entry.definition.name === 'Triceratops'), 'Triceratops should survive the Parallax overkill quirk')
assert(triceratopsBattle.state.fallen.Enemies.some((entry) => entry.definition.name === 'Parallax'), 'Parallax should die to Triceratops overkill')
console.log('Triceratops overkill/Parallax regression passed')

// Turn sequencing regressions: Shuten, Priest, Cosmic Pop Star.
// These lock the live rules that extra turns carry across enemy replacement and
// counterattacks happen inside the opponent's turn rather than consuming a turn.
const hugeEnemy: DepthsEnemy = { card: card('Titan'), power: 1e30, attack: 1, health: 1e30 }

const shutenTurnBattle = simulateBattleV2(
  { cards: [{ cardName: 'Shuten-dōji', borders: ['Galaxy'] }] },
  [
    { card: card('Wizard'), power: 1, attack: 0, health: 1 },
    hugeEnemy,
  ],
  8181,
  5,
  true,
  true,
)
const shutenTurns = shutenTurnBattle.debug?.events.filter((event) => event.type === 'turn').slice(0, 2) || []
assert(shutenTurns.length === 2, 'Shuten sequencing regression did not produce two turns')
assert(shutenTurns[0].team === 'Allies' && shutenTurns[1].team === 'Allies', 'Shuten Decapitate kill should skip the enemy replacement turn')
assert(shutenTurns[0].card === 'Shuten-dōji' && shutenTurns[1].card === 'Shuten-dōji', 'Shuten should keep its extra turn after defeating the front enemy')

const priestTurnBattle = simulateBattleV2(
  { cards: [{ cardName: 'Priest', borders: ['Galaxy'] }] },
  [
    { card: card('Wizard'), power: 1, attack: 0, health: 1 },
    hugeEnemy,
  ],
  8282,
  6,
  true,
  true,
)
const priestTurns = priestTurnBattle.debug?.events.filter((event) => event.type === 'turn').slice(0, 3) || []
assert(priestTurns.length === 3, 'Priest sequencing regression did not produce three turns')
assert(priestTurns[0].team === 'Allies' && priestTurns[1].team === 'Allies', 'Priest Accelerate should start with two total turns (one queued extra turn)')
assert(priestTurns[2].team === 'Enemies', 'Priest first Accelerate cycle should end after exactly two total turns')

const cosmicCounterBattle = simulateBattleV2(
  { cards: [{ cardName: 'Wizard', borders: [] }, { cardName: 'Archer', borders: [] }] },
  [{ card: card('Cosmic Pop Star'), power: 1e12, attack: 1e12, health: 1e30 }],
  8383,
  5,
  true,
  true,
)
const cosmicCounter = cosmicCounterBattle.debug?.events.find((event) => event.type === 'ability' && event.card === 'Cosmic Pop Star' && event.detail?.includes('counterattack'))
assert(Boolean(cosmicCounter), 'Cosmic Pop Star should counterattack during the enemy turn')
const cosmicTurns = cosmicCounterBattle.debug?.events.filter((event) => event.type === 'turn').slice(0, 2) || []
assert(cosmicTurns.length === 2, 'Cosmic counter regression did not produce two turns')
assert(cosmicTurns[0].team === 'Allies' && cosmicTurns[1].team === 'Enemies', 'Counterattack must not consume Cosmic Pop Star\'s following normal turn')
assert(cosmicTurns[1].card === 'Cosmic Pop Star', 'Cosmic Pop Star should take its normal turn after a counter-kill')
console.log('Turn sequencing regressions passed: Shuten, Priest, Cosmic Pop Star')

// Calibration snapshot for the known Shuten/Desmond/Berserker deck.
const calibration: TeamLoadout = {
  cards: [
    { cardName: 'Fuxi', borders: [] },
    { cardName: 'Shuten-dōji', borders: ['Platinum', 'Galaxy'] },
    { cardName: 'Chronus The Hoarder', borders: ['Platinum', 'Crystal', 'Galaxy'] },
    { cardName: 'Malik The Sovereign', borders: ['Platinum', 'Crystal', 'Galaxy'] },
  ],
  statAura: { auraName: 'Desmond Of Despair', border: 'Galaxy' },
  abilityAura: { auraName: 'Berserker', border: 'Galaxy' },
}
const calibrationResult = simulateDepthsBatch(calibration, {
  runs: 20,
  startFloor: 9000,
  floorCap: 15000,
  seed: 0x51a7cafe,
  battleTurnCap: 10000,
})
console.log('Shuten calibration:', JSON.stringify({
  average: Number(calibrationResult.averageFloor.toFixed(1)),
  median: calibrationResult.medianFloor,
  low: calibrationResult.minFloor,
  high: calibrationResult.maxFloor,
}))
