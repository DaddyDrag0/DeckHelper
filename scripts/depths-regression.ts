import cards from '../src/data/cards'
import { cardAge } from '../src/data/ages'
import { createBattleStateV2, simulateBattleV2 } from '../src/engine/battle-v2'
import { DRAGON_CARDS } from '../src/engine/combat-data'
import { depthsMechanics, generateDepthsTeam, getDepthsPool, isDepthsSourceEligible, MAX_DEPTH_BANS } from '../src/engine/depths'
import { simulateDepthsBatch, simulateDepthsRun } from '../src/engine/simulation'
import { getAttack, getHealth, getPower } from '../src/engine/stats'
import type { BattleResult, CardDefinition, CombatCard, DepthsEnemy, TeamLoadout } from '../src/types'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function findBattleCard(result: BattleResult, name: string): CombatCard | undefined {
  return [
    ...result.state.teams.Allies,
    ...result.state.fallen.Allies,
    ...result.state.teams.Enemies,
    ...result.state.fallen.Enemies,
  ].find((card) => card.definition.name === name)
}

function allBattleCards(result: BattleResult): CombatCard[] {
  return [
    ...result.state.teams.Allies,
    ...result.state.fallen.Allies,
    ...result.state.teams.Enemies,
    ...result.state.fallen.Enemies,
  ]
}

function cardByAbility(ability: string) {
  const card = cards.find((candidate) => !candidate.unobtainable && candidate.ability === ability)
  assert(card, `Missing selectable card for ${ability}`)
  return card
}

function cardByName(name: string) {
  const card = cards.find((candidate) => candidate.name === name)
  assert(card, `Missing card ${name}`)
  return card
}

function loadout(names: string[]): TeamLoadout {
  return { cards: names.map((cardName) => ({ cardName, borders: [] })) }
}


// Player-unlocked Depth bans remove only additional cards from the generated pool.
// They are optional (0..14), while the game's built-in hard exclusions always stay excluded.
{
  const floor = 50_000
  const eligibleNames = getDepthsPool(floor).map((entry) => entry.card.name)
  assert(eligibleNames.length > MAX_DEPTH_BANS, 'Expected enough Depth-eligible cards for ban regression')
  const twoBans = eligibleNames.slice(0, 2)
  const twoBanPool = getDepthsPool(floor, twoBans).map((entry) => entry.card.name)
  for (const name of twoBans) assert(!twoBanPool.includes(name), `Player Depth ban did not remove ${name}`)
  assert(twoBanPool.length < eligibleNames.length, 'Two optional Depth bans should shrink the pool')

  const overCapBans = eligibleNames.slice(0, MAX_DEPTH_BANS + 1)
  const cappedPool = getDepthsPool(floor, overCapBans).map((entry) => entry.card.name)
  for (const name of overCapBans.slice(0, MAX_DEPTH_BANS)) {
    assert(!cappedPool.includes(name), `Expected capped player ban to remove ${name}`)
  }
  assert(cappedPool.includes(overCapBans[MAX_DEPTH_BANS]), 'Player Depth bans must cap at 14')

  for (const name of depthsMechanics.hardExclusions) {
    assert(!getDepthsPool(floor, []).some((entry) => entry.card.name === name), `Default Depth ban ${name} must remain excluded`)
  }
}

const dummyDefinition: CardDefinition = {
  name: '__Regression Dummy__',
  imageAssetId: null,
  rarity: 1,
  statMultiplier: 1,
  hpMultiplier: 1,
  ability: null,
  weather: null,
  pack: null,
  boss: false,
  unobtainable: false,
  expires: false,
}

function dummyEnemy(health = 1, attack = 1): DepthsEnemy {
  return {
    card: { ...dummyDefinition },
    power: Math.max(1, attack * 2),
    attack,
    health,
  }
}

function namedDummy(name: string, health: number, attack: number, ability: string | null = null): DepthsEnemy {
  return {
    card: { ...dummyDefinition, name, ability },
    power: Math.max(1, attack * 2),
    attack,
    health,
  }
}

const representatives = new Map<string, (typeof cards)[number]>()
for (const card of cards) {
  if (!isDepthsSourceEligible(card) || !card.ability || representatives.has(card.ability)) continue
  representatives.set(card.ability, card)
}

assert(representatives.size >= 176, `Expected at least 176 Depths abilities, found ${representatives.size}`)

let executed = 0
for (const [ability, card] of representatives) {
  const representativeLoadout: TeamLoadout = { cards: [{ cardName: card.name, borders: [] }] }
  const battle = simulateBattleV2(representativeLoadout, [dummyEnemy()], 10_000 + executed)
  assert(battle.turns > 0 && battle.turns <= 2_000, `${ability}: invalid turn count ${battle.turns}`)
  assert(!battle.unsupportedAbilities.includes(ability), `${ability}: marked unsupported at runtime`)
  executed += 1
}

const pandora = cards.find((card) => card.ability === "Pandora's Box")
assert(pandora, "Pandora's Box card missing")
const pandoraLoadout: TeamLoadout = { cards: [{ cardName: pandora.name, borders: [] }] }
const pandoraA = simulateBattleV2(pandoraLoadout, [dummyEnemy(1e30, 0)], 424_242)
const pandoraB = simulateBattleV2(pandoraLoadout, [dummyEnemy(1e30, 0)], 424_242)
const pandoraCardA = findBattleCard(pandoraA, pandora.name)
const pandoraCardB = findBattleCard(pandoraB, pandora.name)
assert(pandoraCardA && pandoraCardB, 'Pandora disappeared from battle state')
assert(pandoraCardA.bonusAbilities?.length === 2, `Pandora rolled ${pandoraCardA.bonusAbilities?.length ?? 0} bonuses instead of 2`)
assert(new Set(pandoraCardA.bonusAbilities).size === 2, 'Pandora rolled duplicate bonuses')
assert(JSON.stringify(pandoraCardA.bonusAbilities) === JSON.stringify(pandoraCardB.bonusAbilities), 'Pandora is not deterministic for the same seed')

const astraeus = cards.find((card) => card.ability === 'Constellar')
assert(astraeus, 'Astraeus / Constellar card missing')
const astraeusLoadout: TeamLoadout = { cards: [{ cardName: astraeus.name, borders: [] }] }
const astraeusA = simulateBattleV2(astraeusLoadout, [dummyEnemy(1e30, 0)], 77_777)
const astraeusB = simulateBattleV2(astraeusLoadout, [dummyEnemy(1e30, 0)], 77_777)
const astraeusCardA = findBattleCard(astraeusA, astraeus.name)
const astraeusCardB = findBattleCard(astraeusB, astraeus.name)
assert(astraeusCardA && astraeusCardB, 'Astraeus disappeared from battle state')
assert(astraeusCardA.abilityOverride?.startsWith('Constellar'), 'Astraeus did not resolve a Constellar art ability')
assert(astraeusCardA.abilityOverride === astraeusCardB.abilityOverride, 'Constellar art is not deterministic for the same seed')

{
  const whooping = cardByAbility('Whooping')
  assert(cardAge(whooping.name) > 1, `${whooping.name}: expected age > 1 for the Whooping regression`)
  const damage = getAttack(whooping, [])
  const hp = getHealth(whooping, [])
  const enemyHealth = damage * 20 + 100
  const result = simulateBattleV2(loadout([whooping.name]), [namedDummy('__Age One Target__', enemyHealth, hp * 10)], 1101)
  const target = result.state.teams.Enemies[0]
  assert(target, 'Whooping target should survive the opening hit')
  assert(Math.abs((enemyHealth - target.hp) - Math.ceil(damage * 2)) < 1e-6, 'Whooping did not double damage against a younger target')
}

{
  const reveal = cardByAbility('Reveal')
  const damage = getAttack(reveal, [])
  const hp = getHealth(reveal, [])
  const result = simulateBattleV2(loadout([reveal.name]), [namedDummy('__Reveal Target__', damage * 2.2, hp * 0.4)], 1102)
  const holder = result.state.teams.Allies.find((card) => card.definition.name === reveal.name)
  assert(holder, 'Reveal holder should survive the prepared scenario')
  assert(holder.flags.revealed, 'Reveal never fired')
  assert(holder.hp < holder.maxHp * 0.65, 'Reveal incorrectly healed more than once')
  assert(holder.hp > holder.maxHp * 0.5, 'Reveal holder ended below the expected post-second-hit range')
}

{
  const sap = cardByAbility('Sap')
  const damage = getAttack(sap, [])
  const hp = getHealth(sap, [])
  const enemyAttack = Math.max(1, Math.min(damage * 0.25, hp * 0.1))
  const expectedDamage = damage + enemyAttack * 0.5
  const result = simulateBattleV2(loadout([sap.name]), [namedDummy('__Sap Target__', expectedDamage * 1.5, enemyAttack)], 1103)
  const holder = result.state.teams.Allies.find((card) => card.definition.name === sap.name)
  const fallenEnemy = result.state.fallen.Enemies.find((card) => card.definition.name === '__Sap Target__')
  assert(holder && fallenEnemy, 'Sap scenario did not finish in the expected state')
  assert(Math.abs(holder.damage - expectedDamage) <= Math.max(1e-6, Math.abs(expectedDamage) * 1e-12), 'Sap did not gain half the opposing Damage')
  assert(Math.abs(fallenEnemy.damage - enemyAttack * 0.5) <= Math.max(1e-6, enemyAttack * 1e-12), 'Sap did not halve the opposing Damage')
}

{
  const longReach = cardByAbility('Long Reach')
  const damage = getAttack(longReach, [])
  const hp = getHealth(longReach, [])
  const activeHealth = damage * 100 + 100
  const benchHealth = damage * 100 + 200
  let hitActive = false
  let hitBench = false
  for (let seed = 1; seed <= 80 && !(hitActive && hitBench); seed++) {
    const result = simulateBattleV2(
      loadout([longReach.name]),
      [namedDummy('__Long Reach Active__', activeHealth, hp * 10), namedDummy('__Long Reach Bench__', benchHealth, 0)],
      seed,
      1,
      true,
      false,
    )
    const active = findBattleCard(result, '__Long Reach Active__')
    const bench = findBattleCard(result, '__Long Reach Bench__')
    if (active && active.hp < activeHealth) hitActive = true
    if (bench && bench.hp < benchHealth) hitBench = true
  }
  assert(hitActive && hitBench, 'Long Reach should randomly target different living cards across deterministic seeds')
}

{
  const cherub = cardByName('Cherub')
  const damage = getAttack(cherub, [])
  const hp = getHealth(cherub, [])
  const enemyHealth = damage * 100
  const enemyAttack = hp * 0.1
  const result = simulateBattleV2(loadout([cherub.name]), [namedDummy('__Frail Target__', enemyHealth, enemyAttack)], 7711, 2, true, false)
  const enemy = findBattleCard(result, '__Frail Target__')
  const holder = findBattleCard(result, cherub.name)
  assert(enemy && holder, 'Cherub Frail regression lost a prepared card')
  assert(Math.abs((enemyHealth - enemy.hp) - Math.ceil(damage * 1.5)) <= 1e-6, 'Cherub should deal 1.5x damage')
  assert(Math.abs((hp - holder.hp) - Math.ceil(enemyAttack * 1.5)) <= 1e-6, 'Cherub should take 1.5x damage')
}

{
  const longmu = cardByName('Longmu')
  const dragon = cards.find((card) => card.name !== 'Longmu' && DRAGON_CARDS.has(card.name))
  assert(dragon, 'No Dragon card available for Draconian regression')
  const guarding = createBattleStateV2(loadout([longmu.name, dragon.name]), [])
  assert(guarding.teams.Allies[0]?.abilityOverride === 'Safeguarding', 'Slot-1 Longmu did not receive Safeguarding')
  assert(guarding.teams.Allies[0]?.status.shield === 1, 'Slot-1 Longmu did not receive one shield')
  const mother = createBattleStateV2(loadout([dragon.name, longmu.name]), [])
  assert(mother.teams.Allies[1]?.abilityOverride === 'Mother of Dragons', 'Benched Longmu did not receive Mother of Dragons')
  assert(mother.teams.Allies[0]?.status.shield === 2, 'Mother of Dragons did not grant two Dragon shields')
}

{
  const heroes = cardByAbility('Heroes')
  const first = cardByAbility('Armor')
  const second = cardByAbility('Regenerate')
  const result = simulateBattleV2(loadout([first.name, second.name, heroes.name]), [namedDummy('__Heroes Executioner__', 1e250, 1e250)], 1105)
  const holder = findBattleCard(result, heroes.name)
  assert(holder, 'Heroes holder disappeared from battle state')
  assert(JSON.stringify(holder.bonusAbilities) === JSON.stringify(['Armor', 'Regenerate']), 'Heroes did not retain both first-two-fallen abilities')
}

{
  const mirror = cardByAbility('Mirror Image')
  const filler = cardByAbility('Armor')
  const mirrorDamage = getAttack(mirror, [])
  const fillerDamage = getAttack(filler, [])
  const mirrorHp = getHealth(mirror, [])
  const fillerHp = getHealth(filler, [])
  const enemyHealth = mirrorDamage + fillerDamage + mirrorDamage * 0.5
  const enemyAttack = Math.max(mirrorHp, fillerHp) * 20
  let revived = false
  for (let seed = 1; seed <= 100 && !revived; seed++) {
    const result = simulateBattleV2(loadout([mirror.name, filler.name]), [namedDummy('__Mirror Target__', enemyHealth, enemyAttack)], seed)
    const holder = allBattleCards(result).find((card) => card.definition.name === mirror.name && card.flags.mirrorImageReturned)
    if (!holder) continue
    revived = true
    assert(result.winner === 'Allies', 'Revived Mirror Image did not finish the prepared target')
    assert(holder.hp === holder.maxHp, 'Mirror Image did not return at full HP')
  }
  assert(revived, 'No deterministic seed procured Mirror Image in 100 attempts')
}

{
  const composer = cardByAbility('Nightmare Melody')
  const damage = getAttack(composer, [])
  const initial = createBattleStateV2(loadout([composer.name]), [namedDummy('__Composer Initial__', damage * 5, 0)])
  assert(initial.boosts.Allies.composerCount === 1, 'Nightmare Melody field count did not initialize')
  assert(initial.boosts.Allies.composerThreshold === 1, 'Nightmare Melody threshold did not initialize at 1')
  const result = simulateBattleV2(loadout([composer.name]), [namedDummy('__Composer Target__', damage * 4.5, 0)], 1106)
  assert(result.state.boosts.Allies.composerCount === 1, 'Living Composer unexpectedly lost its field count')
  assert(Math.abs((result.state.boosts.Allies.composerThreshold ?? 0) - 0.6) < 1e-12, 'Nightmare Melody threshold did not cap at 0.6')
}

{
  const trickster = cardByAbility('God of Trickery')
  const shapeshifter = cardByAbility('Shapeshifter')
  const filler = cardByAbility('Armor')

  const identityTarget = (attacker: CardDefinition): DepthsEnemy => ({
    card: filler,
    power: getHealth(attacker, []) * 20,
    attack: getHealth(attacker, []) * 10,
    health: 1e200,
  })

  let trickSeed = 0
  let trickIdentity = ''
  for (let seed = 1; seed <= 50 && !trickSeed; seed++) {
    const result = simulateBattleV2(loadout([trickster.name]), [identityTarget(trickster)], seed)
    const holder = findBattleCard(result, trickster.name)
    const enemy = findBattleCard(result, filler.name)
    if (holder?.identityOverride === filler.name && enemy?.identityOverride) {
      trickSeed = seed
      trickIdentity = enemy.identityOverride
    }
  }
  assert(trickSeed > 0 && trickIdentity, 'God of Trickery never produced a stable identity-transfer scenario')
  const trickRepeat = simulateBattleV2(loadout([trickster.name]), [identityTarget(trickster)], trickSeed)
  assert(findBattleCard(trickRepeat, filler.name)?.identityOverride === trickIdentity, 'God of Trickery identity was not seed-repeatable')

  const shapeA = simulateBattleV2(loadout([shapeshifter.name]), [identityTarget(shapeshifter)], 2202)
  const shapeB = simulateBattleV2(loadout([shapeshifter.name]), [identityTarget(shapeshifter)], 2202)
  const shapeCardA = findBattleCard(shapeA, shapeshifter.name)
  const shapeCardB = findBattleCard(shapeB, shapeshifter.name)
  assert(shapeCardA?.identityOverride, 'Shapeshifter never assumed a random identity')
  assert(shapeCardA.identityOverride === shapeCardB?.identityOverride, 'Shapeshifter identity was not seed-repeatable')
}

{
  const jealousy = cardByAbility('Jealousy')
  const damage = getAttack(jealousy, [])
  const hp = getHealth(jealousy, [])
  const suppressionHealth = damage * 100 + 100
  const suppression = simulateBattleV2(loadout([jealousy.name]), [namedDummy('__Jealous Armor__', suppressionHealth, hp * 10, 'Armor')], 3301)
  const suppressionTarget = suppression.state.teams.Enemies.find((card) => card.definition.name === '__Jealous Armor__')
  assert(suppressionTarget, 'Jealousy suppression target should survive the opening hit')
  assert(Math.abs((suppressionHealth - suppressionTarget.hp) - Math.ceil(damage)) < 1e-6, 'Jealousy did not suppress opposing Armor')

  const copied = simulateBattleV2(loadout([jealousy.name]), [namedDummy('__Jealous Armor Copy__', damage * 1.5, hp * 0.2, 'Armor')], 3302)
  const sable = copied.state.teams.Allies.find((card) => card.definition.name === jealousy.name)
  assert(sable, 'Sable did not survive the copied-Armor scenario')
  const lostFraction = (sable.maxHp - sable.hp) / sable.maxHp
  assert(lostFraction >= 0.09 && lostFraction <= 0.11, `Jealousy copied Armor incorrectly; lost ${(lostFraction * 100).toFixed(2)}% HP`)
}

const strongest = cards
  .filter(isDepthsSourceEligible)
  .map((card) => ({ card, power: getPower(card, []) }))
  .filter((entry) => Number.isFinite(entry.power) && entry.power > 0)
  .sort((a, b) => b.power - a.power)
  .slice(0, 4)
  .map((entry) => ({ cardName: entry.card.name, borders: [] as TeamLoadout['cards'][number]['borders'] }))

assert(strongest.length === 4, 'Could not build a four-card regression team')
const fixedDepthsExclusions = [
  'Vampire Lord',
  'Parallax',
  'Samurai',
]
for (const name of fixedDepthsExclusions) {
  const card = cardByName(name)
  assert(!isDepthsSourceEligible(card), `${name} must remain excluded from Depths enemy generation`)
}
const runLoadout: TeamLoadout = { cards: strongest }

const batchOptions = { runs: 3, startFloor: 1, floorCap: 20, seed: 98_765, battleTurnCap: 2_000 }
const batchA = simulateDepthsBatch(runLoadout, batchOptions)
const batchB = simulateDepthsBatch(runLoadout, batchOptions)
assert(JSON.stringify(batchA) === JSON.stringify(batchB), 'Depths batch is not deterministic for identical inputs')
assert(batchA.runs.length === 3, 'Depths batch returned the wrong number of runs')
assert(batchA.runs.every((run) => run.battles >= 1 && run.battles <= 20), 'Depths batch produced an invalid battle count')
assert(batchA.runs.every((run) => Number.isFinite(run.totalTurns)), 'Depths batch produced a non-finite turn count')

const highFloor = simulateDepthsRun(runLoadout, { startFloor: 1_000, floorCap: 1_002, seed: 246_810, battleTurnCap: 2_000 })
assert(highFloor.battles >= 1 && highFloor.battles <= 3, `High-floor run used ${highFloor.battles} battles`)
assert(highFloor.totalTurns >= 1 && highFloor.totalTurns <= 6_000, `High-floor run used ${highFloor.totalTurns} turns`)
assert(Number.isFinite(highFloor.deathFloor), 'High-floor run returned a non-finite death floor')

console.log(`Depths regression tests passed: executed ${executed}/176 abilities.`)
console.log('Final selectable-player mechanics regression suite passed.')
console.log(`Pandora seed bonuses: ${pandoraCardA.bonusAbilities?.join(' + ')}`)
console.log(`Constellar seed art: ${astraeusCardA.abilityOverride}`)
console.log(`Regression team: ${strongest.map((slot) => slot.cardName).join(' | ')}`)
console.log(`20-floor batch death floors: ${batchA.runs.map((run) => run.deathFloor).join(', ')}`)
console.log(`High-floor check: deathFloor=${highFloor.deathFloor}, battles=${highFloor.battles}, turns=${highFloor.totalTurns}`)
