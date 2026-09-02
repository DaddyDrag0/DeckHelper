import assert from 'node:assert/strict'
import { buildSkillAuraBoosts, getAura, getSkillAuraValue } from '../src/engine/auras'

const expected = [
  ['Storm Spirit', 'stormSpirit', [10, 15, 20, 30]],
  ['Guardian Angel', 'guardianAngel', [10, 15, 20, 30]],
  ['Executioner', 'executioner', [15, 25, 35, 50]],
  ['Mirror Knight', 'mirrorKnight', [10, 15, 20, 30]],
  ['Final Testament', 'finalTestament', [5, 7.5, 10, 12.5]],
] as const

for (const [name, boostKey, values] of expected) {
  const aura = getAura(name)
  assert.ok(aura, `Missing new aura ${name}`)
  assert.equal(aura.unobtainable, false, `${name} should be obtainable`)
  assert.equal(getSkillAuraValue(aura, null), values[0], `${name} Base value`)
  assert.equal(getSkillAuraValue(aura, 'Platinum'), values[1], `${name} Platinum value`)
  assert.equal(getSkillAuraValue(aura, 'Crystal'), values[2], `${name} Crystal value`)
  assert.equal(getSkillAuraValue(aura, 'Galaxy'), values[3], `${name} Galaxy value`)
  const built = buildSkillAuraBoosts({ auraName: name })
  assert.equal(built.implemented, true, `${name} must be implemented by the simulator`)
  assert.equal((built.boosts as unknown as Record<string, number>)[boostKey], values[0], `${name} combat boost`)
}


const virtueRarities: Record<string, number> = {
  'Cedric Of Charity': 1_000_000_000,
  'Armin Of Humility': 2_000_000_000,
  'Krug Of Temperance': 3_000_000_000,
  'Lena Of Purity': 4_000_000_000,
  'Bruno Of Diligence': 5_000_000_000,
  'Skye Of Patience': 6_000_000_000,
  'Celeste Of Kindness': 10_000,
}
for (const [name, rarity] of Object.entries(virtueRarities)) {
  assert.equal(getAura(name)?.rarity, rarity, `${name} rarity should match NEW source`)
}

console.log('New blue aura regression passed.')
