import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import { ALL_CARD_BORDER_VARIANTS, borderKey } from '../src/card-variants'
import { EXPANSION_BORDER_PALETTES, formatGameRarity, mergeScannedVariants, parseGameRarityText } from '../src/importer'

assert.equal(ALL_CARD_BORDER_VARIANTS.length, 16, 'Four stackable borders must produce 16 exact variants including Base')
for (const variant of ALL_CARD_BORDER_VARIANTS) {
  assert.ok(EXPANSION_BORDER_PALETTES[variant.key]?.length, `Missing visual palette for ${variant.label}`)
}

assert.equal(formatGameRarity(120_000_000_000_000), '120T')
assert.equal(formatGameRarity(5_600_000_000_000), '5.6T')
assert.equal(formatGameRarity(3_000_000_000_000_000), '3qd')
assert.equal(parseGameRarityText('120T'), 120_000_000_000_000)
assert.equal(parseGameRarityText('5.6T'), 5_600_000_000_000)

const baseRarity = 50_000_000
const platinumCrystal = baseRarity * 100 * 10_000
const galaxy = baseRarity * 1_000_000
assert.equal(platinumCrystal, galaxy, 'Platinum + Crystal and Galaxy intentionally collide in effective rarity')

const merged = mergeScannedVariants(
  [{ cardName: "Heaven's Armor", borders: ['Galaxy'], quantity: 1 }],
  [
    { cardName: "Heaven's Armor", borders: ['Platinum', 'Crystal'], quantity: 1 },
    { cardName: "Heaven's Armor", borders: ['Galaxy'], quantity: 2 },
  ],
)
assert.equal(merged.length, 2, 'Same card name with different border combinations must remain separate inventory variants')
const galaxyEntry = merged.find((entry) => borderKey(entry.borders) === 'Galaxy')
const pcEntry = merged.find((entry) => borderKey(entry.borders) === 'Platinum+Crystal')
assert.equal(galaxyEntry?.quantity, 3)
assert.equal(pcEntry?.quantity, 1)

console.log('Importer and exact card-variant regression passed.')


const sourceHtml = readFileSync('source.html', 'utf8')
const importerSource = readFileSync('src/importer.ts', 'utf8')
if (!sourceHtml.includes('@tensorflow/tfjs@4.22.0') || !sourceHtml.includes('@tensorflow-models/mobilenet@2.1.1')) {
  throw new Error('Screenshot importer image-model scripts are missing.')
}
if (!importerSource.includes("model.infer(canvas, true)") || !importerSource.includes("MobileNet artwork")) {
  throw new Error('Screenshot importer is not using the crop-tolerant image matcher.')
}
