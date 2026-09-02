import { strict as assert } from 'node:assert'
import cards from '../src/data/cards'
import auras from '../src/data/auras'
import { createBattleStateV2, simulateBattleV2 } from '../src/engine/battle-v2'
import { getAttack, getHealth } from '../src/engine/stats'
import { getStatAuraValue, statAuraPercentForCard } from '../src/engine/auras'
import type { DepthsEnemy } from '../src/types'

function card(name: string) { const c = cards.find(x => x.name === name); assert(c, 'Missing card '+name); return c }
function aura(name: string) { const a = auras.find(x => x.name === name); assert(a, 'Missing aura '+name); return a }
function enemy(name: string, health: number, attack: number): DepthsEnemy { return { card: card(name), power: health, health, attack } }
function close(actual:number, expected:number, label:string) { assert(Math.abs(actual-expected) <= Math.max(1e-6, Math.abs(expected)*1e-9), label+': expected '+expected+', got '+actual) }

for (const [name, rarity, image, ability, pack] of [
  ['Limitless Rivals',3500000,110002833266451,'Cosmic Rivalry',null],
  ['The Awakened One',17000000,79559745346915,'Six Realms Staff','Immortal'],
  ['Ultimate Brawler',9000000,123755387112417,'Divine Ascension','Anime'],
  ['The Curse',6660666,109272849583933,'Kitchen',null],
] as const) { const c=card(name); assert.equal(c.rarity,rarity); assert.equal(c.imageAssetId,image); assert.equal(c.statMultiplier,9); assert.equal(c.weather,'Manga'); assert.equal(c.ability,ability); assert.equal(c.pack,pack) }

const mangaAura = aura('Mangeka')
assert.equal(getStatAuraValue(mangaAura,'Galaxy'),207)
close(statAuraPercentForCard(mangaAura, { definition:card('Limitless Rivals') } as any, 'Galaxy'), 300, 'Mangeka Galaxy Manga boost')
const oneRing = aura('The One Ring')
assert.equal(getStatAuraValue(oneRing,'Galaxy'),315)
close(statAuraPercentForCard(oneRing, { definition:card('Arthur') } as any, 'Galaxy'),315,'One Ring normal card')
close(statAuraPercentForCard(oneRing, { definition:card('Limitless Rivals') } as any, 'Galaxy'),0,'One Ring excludes weather')
close(statAuraPercentForCard(aura('Dinosaur King'), { definition:card('Ankylosaurus') } as any, 'Galaxy'),414,'Dino exact group multiplier')
close(statAuraPercentForCard(aura('Elohim'), { definition:cards.find(c=>c.weather==='Rapture')! } as any, 'Galaxy'),300,'Elohim exact group multiplier')
const satan=aura('Satan'); const blood=cards.find(c=>c.weather==='Blood Rain'); assert(blood); close(statAuraPercentForCard(satan,{definition:blood} as any,'Galaxy'),282.5,'Satan Blood Rain boost remains source value')

const brawler=card('Ultimate Brawler')
const brawl=simulateBattleV2({cards:[{cardName:'Ultimate Brawler',borders:[]}]},[enemy('Shining Armor',1e30,1e30)],81123,2,false,true)
const ub=[...brawl.state.teams.Allies,...brawl.state.fallen.Allies].find(c=>c.definition.name==='Ultimate Brawler'); assert(ub); assert.equal(ub.abilityOverride,'Mastered Ascension'); close(ub.maxHp,getHealth(brawler)*1.5,'Brawler awakened HP'); close(ub.damage,getAttack(brawler)*1.5,'Brawler awakened ATK')

for (let seed=1; seed<=12; seed++) { const result=simulateBattleV2({cards:[{cardName:'The Awakened One',borders:[]}]},[enemy('Shining Armor',1e30,0)],90000+seed,1); assert.equal(result.trusted,true,'Six Realms seed '+seed+' must be supported') }

const baseArthur=getHealth(card('Arthur'))
const ringState=createBattleStateV2({cards:[{cardName:'Arthur',borders:[]}],statAura:{auraName:'The One Ring',border:'Galaxy'}},[])
close(ringState.teams.Allies[0].maxHp,baseArthur*4.15,'One Ring 315% stat application')
console.log('Manga weather regression passed.')
