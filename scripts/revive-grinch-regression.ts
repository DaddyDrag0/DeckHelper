import cards from '../src/data/cards'
import { simulateBattleV2 } from '../src/engine/battle-v2'
import type { DepthsEnemy, TeamLoadout } from '../src/types'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const hades = cards.find((card) => card.name === 'Hades')
const buddha = cards.find((card) => card.name === 'Buddha')
assert(hades && buddha, 'Hades/Buddha regression cards missing')

const reviveEnemies: DepthsEnemy[] = [
  { card: hades, power: 100, attack: 50, health: 100 },
  { card: buddha, power: 100, attack: 50, health: 100 },
]
const reviveLoadout: TeamLoadout = {
  cards: [{ cardName: "Hell's Army", borders: ['Galaxy'] }],
}
const reviveBattle = simulateBattleV2(reviveLoadout, reviveEnemies, 445566, 10000, true, true)
assert(reviveBattle.winner === 'Allies', `Hades/Buddha loop did not resolve; winner=${reviveBattle.winner}`)
assert(reviveBattle.turns < 100, `Hades/Buddha revival loop took ${reviveBattle.turns} turns`)
assert(!reviveBattle.unsupportedAbilities.includes('Battle turn cap reached'), 'Hades/Buddha hit emergency turn cap')

const source = await import('node:fs').then((fs) => fs.readFileSync('src/engine/battle-v2.ts', 'utf8'))
assert(source.includes('!target.flags.stealChristmasUsed'), 'Steal Christmas one-use guard missing')
assert(source.includes('target.flags.stealChristmasUsed = true'), 'Steal Christmas activation flag missing')
assert(source.includes("case 'Decapitate': damage *= 2; break"), 'Shuten 2x Decapitate damage not restored')
assert(source.includes('boostStats(attacker, 1.2)'), 'Shuten +20% confirmed-kill reward not restored')
assert(source.includes('attacker.flags.extraTurn = true'), 'Shuten extra turn not restored')
assert(source.includes('cards.map((card) => card.ability)'), 'Pandora full ability pool not restored')
assert(!source.includes('cards.filter((card) => !card.expires).map((card) => card.ability)'), 'Pandora is still excluding limited cards')

console.log('Hades/Buddha finite revival regression passed:', reviveBattle.turns, 'turns')
console.log('Grinch one-use, original Shuten, and full Pandora pool guards passed.')
