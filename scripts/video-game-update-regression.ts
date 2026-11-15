import { strict as assert } from 'node:assert'
import cards from '../src/data/cards'
import auras from '../src/data/auras'
import { simulateBattleV2 } from '../src/engine/battle-v2'
import { getAttack, getHealth } from '../src/engine/stats'
import { statAuraPercentForCard } from '../src/engine/auras'
import type { DepthsEnemy } from '../src/types'
const card=(name:string)=>{const c=cards.find(c=>c.name===name);assert(c,name);return c}
const foe=(hp=1e30,damage=0):DepthsEnemy=>({card:card('Shining Armor'),power:hp,health:hp,attack:damage})
const run=(name:string, turns=1, hp=1e30, damage=0)=>simulateBattleV2({cards:[{cardName:name,borders:[]}]},[foe(hp,damage)],1234,turns,false,true)
const actor=(r:ReturnType<typeof run>,name:string)=>{const c=[...r.state.teams.Allies,...r.state.fallen.Allies].find(c=>c.definition.name===name);assert(c,name);return c}
const close=(a:number,b:number)=>assert(Math.abs(a-b)<Math.max(1,Math.abs(b))*1e-9,`${a} != ${b}`)
const videoGameCards=cards.filter(c=>c.pack==='Video Game')
const originalVideoGameCards=videoGameCards.filter(c=>c.name!=='The Leviathan')
assert.equal(originalVideoGameCards.length,12)
assert.equal(videoGameCards.length,13,'November export adds The Leviathan to the Video Game pack')
assert.equal(card('The Leviathan').ability,'Devour the Deep')
for(const name of ['The Sequel','Myths','Gamer']) {
 const aura=auras.find(a=>a.name===name)!; assert(aura)
 const c=name==='The Sequel'?card('Hunter'):name==='Myths'?card('Mother of Beasts'):card('Durante')
 const value=statAuraPercentForCard(aura,{definition:c} as any,'Galaxy')
 assert(value<=300); assert(value>290)
}
const sack=actor(run('The Sack'),'The Sack')
assert(sack.damage>=getAttack(card('The Sack'))*1.01&&sack.damage<=getAttack(card('The Sack'))*1.5)
assert(sack.counters.d8Reduction>=.01&&sack.counters.d8Reduction<=.3)
const steven=actor(run('Steven'),'Steven');close(steven.counters.blockHp,steven.maxHp*.4)
const necro=actor(run('Necro-orc'),'Necro-orc');close(necro.hp,necro.maxHp*.85)
const ice=run('Ice King');assert.equal(ice.state.teams.Enemies[0].status.stunned,0)
const box=actor(run('NO.2',2,1e30,1e30),'NO.2');assert.equal(box.hp,1);assert(box.flags.blackBoxUsed)
const broken=run('The Broken One',2,1e30,1e30)
assert.deepEqual(broken.state.teams.Allies.slice(0,2).map(c=>c.definition.name),['Joy','Sorrow'])
close(broken.state.teams.Allies[0].maxHp,getHealth(card('The Broken One'))*.5)
close(broken.state.teams.Allies[0].damage,getAttack(card('The Broken One'))*.6)
const ozzy=run('Supreme Ozzy',2,1e30,10);close(ozzy.state.teams.Enemies[0].hp,1e30)
close(actor(ozzy,'Supreme Ozzy').damage,getAttack(card('Supreme Ozzy'))+12.5)
const glory=actor(run('Hell killer',1,1),'Hell killer');close(glory.damage,getAttack(card('Hell killer'))*1.5)
for(const c of originalVideoGameCards) {const r=run(c.name);assert.equal(r.trusted,true,`${c.name} must be fully supported`);assert(!r.state.unsupportedAbilities.has(c.ability!))}
for(const name of ['The Broken One','Supreme Ozzy']) {const r=run(name,2,1e30,10);assert.equal(r.trusted,true,`${name} must be fully supported`);assert(!r.state.unsupportedAbilities.size,`${name} has unsupported abilities`)}
const newLeviathan=run('The Leviathan')
assert(newLeviathan.unsupportedAbilities.includes('Devour the Deep'),'Unported November card must be flagged untrusted')
console.log('Video Game 12 original effects passed; new The Leviathan remains untrusted pending model port.')
