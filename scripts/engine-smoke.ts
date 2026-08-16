import cards from '../src/data/cards'
import auras from '../src/data/auras'
import { depthBudget, generateDepthsTeam } from '../src/engine/depths'
import { getAura, getSkillAuraValue, getStatAuraValue } from '../src/engine/auras'
import { getAttack, getHealth, rarityWithBorders } from '../src/engine/stats'
import { simulateBattleV2 } from '../src/engine/battle-v2'
import { getDepthsAbilityCoverage } from '../src/engine/support'
import type { CardDefinition, DepthsEnemy, TeamLoadout } from '../src/types'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function close(actual: number, expected: number, epsilon = 1e-8) {
  assert(Math.abs(actual - expected) <= epsilon, `Expected ${expected}, got ${actual}`)
}

assert(cards.length > 250, 'Card data did not load')
assert(auras.length > 40, 'Aura data did not load')

const mastermind = cards.find((card) => card.name === 'Mastermind')
assert(mastermind, 'Mastermind missing')
close(rarityWithBorders(mastermind, ['Platinum', 'Crystal']), mastermind.rarity * 100 * 10_000)
assert(getHealth(mastermind) > getAttack(mastermind), 'Basic HP/ATK relationship is invalid')

const fate = getAura('Fate')
assert(fate, 'Fate aura missing')
close(getSkillAuraValue(fate), 25)
close(getSkillAuraValue(fate, 'Galaxy'), 100)

const kala = getAura('Kala')
assert(kala, 'Kala aura missing')
close(getStatAuraValue(kala, 'Galaxy'), 103)

close(depthBudget(1), 3040)
const teamA = generateDepthsTeam(250, 123456)
const teamB = generateDepthsTeam(250, 123456)
assert(teamA.length === 4, 'Depths must generate four enemies')
assert(teamA.map((x) => x.card.name).join('|') === teamB.map((x) => x.card.name).join('|'), 'Seeded Depths generation is not deterministic')

// A controlled no-ability battle verifies the turn/death skeleton without relying on card ability balance.
const dummy: CardDefinition = {
  name: '__Smoke Dummy__', imageAssetId: null, rarity: 1, statMultiplier: 1, hpMultiplier: 1,
  ability: null, weather: null, pack: null, boss: false, unobtainable: false, expires: false,
}
const enemies: DepthsEnemy[] = Array.from({ length: 4 }, (_, index) => ({
  card: { ...dummy, name: `__Smoke Enemy ${index + 1}__` },
  power: 10,
  attack: 5,
  health: 10,
}))
const loadout: TeamLoadout = {
  cards: [{ cardName: 'Mastermind', borders: ['Galaxy'] }],
}
const battle = simulateBattleV2(loadout, enemies, 7)
assert(battle.winner === 'Allies', 'Controlled battle should be won by the player card')
assert(battle.turns > 0, 'Controlled battle did not advance turns')

const fateBattle = simulateBattleV2({ cards: [{ cardName: 'Mastermind', borders: ['Galaxy'] }], abilityAura: { auraName: 'Fate' } }, enemies, 8)
assert(!fateBattle.unsupportedAbilities.includes('Aura: Fate'), 'Fate was incorrectly marked unsupported')

const coverage = getDepthsAbilityCoverage()
assert(coverage.total > 150, 'Depths ability coverage scan did not see the full pool')
assert(coverage.unsupported === 0, `Unimplemented Depths abilities remain: ${coverage.unsupportedAbilities.join(', ')}`)

const timeoutEnemies: DepthsEnemy[] = [{
  card: { ...dummy, name: '__Timeout Enemy__' },
  power: 1,
  attack: 0,
  health: 1e30,
}]
const timeoutBattle = simulateBattleV2(
  { cards: [{ cardName: 'Mastermind', borders: [] }] },
  timeoutEnemies,
  12345,
  10_000,
  true,
)
assert(!timeoutBattle.unsupportedAbilities.includes('Battle turn cap reached'), 'Stable active-pair timeout failed before emergency cap')
assert(timeoutBattle.turns >= 145 && timeoutBattle.turns <= 155, `Expansion timeout should resolve at about 150 no-progress turns, got ${timeoutBattle.turns}`)
console.log('Expansion 150-turn no-progress regression passed:', timeoutBattle.turns, 'turns')

// Regression for the floor-388 failure: Serket must not make Zombie Dragon's
// Unholy Creature lifespan permanent, and Decapitate must not chain fake kills
// while Zombie Dragon is surviving at 1 HP.
const zombieDragon = cards.find((card) => card.name === 'Zombie Dragon')
const serket = cards.find((card) => card.name === 'Serket')
assert(zombieDragon && serket, 'Zombie Dragon/Serket regression cards missing')
const zombieSerketEnemies: DepthsEnemy[] = [
  { card: zombieDragon, power: 100, attack: 50, health: 100 },
  { card: serket, power: 100, attack: 50, health: 100 },
]
const zombieSerketBattle = simulateBattleV2(
  { cards: [{ cardName: 'Shuten-dōji', borders: ['Galaxy'] }] },
  zombieSerketEnemies,
  388388,
  10_000,
  true,
)
assert(zombieSerketBattle.winner === 'Allies', `Shuten should beat low-stat Zombie Dragon + Serket, got ${zombieSerketBattle.winner}`)
assert(zombieSerketBattle.turns < 50, `Zombie Dragon + Serket interaction took too long: ${zombieSerketBattle.turns} turns`)
console.log('Zombie Dragon + Serket + Decapitate regression passed:', zombieSerketBattle.turns, 'turns')

// Expansion 2 event cards from the latest uploaded game file.
for (const name of ['Fate Seamstress', 'Eclipseborn Luminant', 'Eonus']) {
  assert(cards.some((card) => card.name === name), `New Expansion card missing: ${name}`)
}
assert(cards.length >= 288, `Expected at least 288 cards after Expansion 2 update, got ${cards.length}`)

// Bind Fate permanently links the first two enemies; a hit to one mirrors the same
// HP loss to its linked partner.
const bindEnemies: DepthsEnemy[] = [
  { card: { ...dummy, name: '__Bind A__' }, power: 1e9, attack: 0, health: 1e9 },
  { card: { ...dummy, name: '__Bind B__' }, power: 1e9, attack: 0, health: 1e9 },
]
const bindBattle = simulateBattleV2({ cards: [{ cardName: 'Fate Seamstress', borders: [] }] }, bindEnemies, 9911, 1)
const bindA = bindBattle.state.teams.Enemies.find((card) => card.definition.name === '__Bind A__')
const bindB = bindBattle.state.teams.Enemies.find((card) => card.definition.name === '__Bind B__')
assert(bindA && bindB, 'Bind Fate test enemies missing')
const bindLossA = 1e9 - bindA.hp
const bindLossB = 1e9 - bindB.hp
assert(bindLossA > 0 && Math.abs(bindLossA - bindLossB) < 1e-6, `Bind Fate did not share damage equally: ${bindLossA} vs ${bindLossB}`)

// Ouroboros steals 5% from all other living cards on entry, then its stolen bonus
// decays after three turns taken by the holder.
const ouroEnemy: DepthsEnemy[] = [{ card: { ...dummy, name: '__Ouroboros Enemy__' }, power: 1e12, attack: 0, health: 1e12 }]
const ouroEntry = simulateBattleV2({ cards: [{ cardName: 'Eonus', borders: [] }, { cardName: 'Mastermind', borders: [] }] }, ouroEnemy, 9922, 1)
const ouroEntryCard = ouroEntry.state.teams.Allies.find((card) => card.definition.name === 'Eonus')
const ouroAlly = ouroEntry.state.teams.Allies.find((card) => card.definition.name === 'Mastermind')
assert(ouroEntryCard && ouroAlly, 'Ouroboros entry test cards missing')
assert((ouroEntryCard.counters.ouroborosBonusDamage || 0) > 0, 'Ouroboros did not gain stolen ATK')
assert(ouroAlly.damage < (ouroAlly.counters.normalDamage || ouroAlly.damage), 'Ouroboros did not steal allied ATK')
const ouroDecay = simulateBattleV2({ cards: [{ cardName: 'Eonus', borders: [] }, { cardName: 'Mastermind', borders: [] }] }, ouroEnemy, 9922, 5)
const ouroDecayCard = ouroDecay.state.teams.Allies.find((card) => card.definition.name === 'Eonus')
assert(ouroDecayCard, 'Ouroboros decay holder missing')
assert(!ouroDecayCard.flags.ouroborosActive, 'Ouroboros stolen stats did not decay after three holder turns')
close(ouroDecayCard.damage, ouroDecayCard.counters.normalDamage || ouroDecayCard.damage, 1e-6)

// Luminescent Veil must be able to evade an incoming hit and feed 10% of the
// prevented damage into its holder's ATK. Search a small deterministic seed set.
let veilWorked = false
for (let seed = 1; seed <= 100 && !veilWorked; seed++) {
  const veilBattle = simulateBattleV2(
    { cards: [{ cardName: 'Eclipseborn Luminant', borders: [] }] },
    [{ card: { ...dummy, name: '__Veil Enemy__' }, power: 1e12, attack: 100, health: 1e12 }],
    seed, 2,
  )
  const luminant = veilBattle.state.teams.Allies.find((card) => card.definition.name === 'Eclipseborn Luminant')
  if (luminant && (luminant.counters.luminescentEvades || 0) > 0) {
    assert(luminant.damage > (luminant.counters.normalDamage || 0), 'Luminescent Veil evade did not increase holder ATK')
    veilWorked = true
  }
}
assert(veilWorked, 'Luminescent Veil never evaded in deterministic seed search')

// The Discord-reported Zombie Dragon -> Hades sequence is explicitly guarded:
// The Underworld does copy Unholy Creature and Hades receives its survival state.
const hadesCopyBattle = simulateBattleV2(
  { cards: [{ cardName: 'Zombie Dragon', borders: [] }, { cardName: 'Hades', borders: [] }] },
  [{ card: { ...dummy, name: '__Hades Copy Enemy__' }, power: 1e12, attack: 1_000_000, health: 1e12 }],
  9933, 20, true, true,
)
const fallenHades = hadesCopyBattle.state.fallen.Allies.find((card) => card.definition.name === 'Hades')
assert(fallenHades, 'Hades copy regression did not reach Hades')
assert(fallenHades.abilityOverride === 'Unholy Creature', `Hades copied the wrong ability: ${fallenHades.abilityOverride}`)
assert(Boolean(fallenHades.flags.unholyActive), 'Copied Unholy Creature never activated on Hades')
console.log('Expansion 2 card regressions passed: Bind Fate, Luminescent Veil, Ouroboros, Zombie Dragon -> Hades copy.')

// Ability-disable regression: revive/lethal-reset abilities must not bypass Fuxi's
// Order of the Cosmos or Hell's Curse. Noveau Riche's Unpaid 'Interns' previously
// revived from the shared tryRevive() path even while the card was locked/sealed.
const noveauRiche = cards.find((card) => card.name === 'Noveau Riche')
assert(noveauRiche, 'Noveau Riche regression card missing')
const internEnemy = (): DepthsEnemy[] => [{ card: noveauRiche, power: 10, attack: 0, health: 10 }]

const fuxiLockBattle = simulateBattleV2(
  { cards: [{ cardName: 'Fuxi', borders: ['Galaxy'] }] },
  internEnemy(),
  9944, 1, false, true,
)
const fuxiIntern = [...fuxiLockBattle.state.teams.Enemies, ...fuxiLockBattle.state.fallen.Enemies]
  .find((card) => card.definition.name === 'Noveau Riche')
assert(fuxiIntern, 'Fuxi/Noveau regression target missing')
assert((fuxiIntern.counters.interns || 0) === 0, `Order of the Cosmos failed to suppress Unpaid Interns: ${fuxiIntern.counters.interns}`)
assert(fuxiLockBattle.state.fallen.Enemies.some((card) => card.definition.name === 'Noveau Riche'), 'Noveau Riche survived while Order of the Cosmos was active')

const hellSealBattle = simulateBattleV2(
  { cards: [{ cardName: "Hell's Army", borders: ['Galaxy'] }] },
  internEnemy(),
  9955, 1, false, true,
)
const hellIntern = [...hellSealBattle.state.teams.Enemies, ...hellSealBattle.state.fallen.Enemies]
  .find((card) => card.definition.name === 'Noveau Riche')
assert(hellIntern, "Hell's Army/Noveau regression target missing")
assert(Boolean(hellIntern.flags.sealed), "Hell's Curse did not seal Noveau Riche")
assert((hellIntern.counters.interns || 0) === 0, `Hell's Curse failed to suppress Unpaid Interns: ${hellIntern.counters.interns}`)
assert(hellSealBattle.state.fallen.Enemies.some((card) => card.definition.name === 'Noveau Riche'), "Noveau Riche survived after Hell's Curse removed its ability")
console.log("Ability-disable revive regression passed: Fuxi and Hell's Curse suppress Unpaid Interns.")

// Buddha regression: Lotus Sutra is a turn action, not an entry effect. Meteosaurus
// dies on its own first turn; the zero-ATK enemy then acts; Buddha receives the next
// allied turn and must revive Meteosaurus at 50% HP.
const buddhaEnemy: DepthsEnemy[] = [{
  card: { ...dummy, name: '__Buddha Turn Enemy__' }, power: 1e20, attack: 0, health: 1e20,
}]
const buddhaBattle = simulateBattleV2(
  { cards: [{ cardName: 'Meteosaurus', borders: [] }, { cardName: 'Buddha', borders: [] }] },
  buddhaEnemy,
  9966, 3, false, true,
)
const revivedMeteosaurus = buddhaBattle.state.teams.Allies.find((card) => card.definition.name === 'Meteosaurus')
assert(revivedMeteosaurus, 'Buddha failed to revive Meteosaurus when Lotus Sutra received a turn')
close(revivedMeteosaurus.hp, revivedMeteosaurus.maxHp * 0.5, 1e-6)
assert(buddhaBattle.debug?.events.some((event) => event.type === 'ability' && event.detail.includes('Lotus Sutra revived Meteosaurus')), 'Lotus Sutra revive interaction missing from debug events')
console.log('Buddha Lotus Sutra turn regression passed.')

console.log(`Engine smoke tests passed: ${cards.length} cards, ${auras.length} auras.`)
console.log(`Source-aligned Depths ability coverage: ${coverage.supported}/${coverage.total} (${coverage.percent.toFixed(1)}%).`)
console.log(`Remaining unsupported Depths abilities (${coverage.unsupported}): ${coverage.unsupportedAbilities.join(' | ')}`)
