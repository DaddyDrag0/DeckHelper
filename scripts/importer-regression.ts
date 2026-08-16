import { existsSync, readFileSync, statSync } from 'node:fs'
import assert from 'node:assert/strict'
import cards from '../src/data/cards'
import thumbnails from '../src/data/thumbnails.json'
import type { CardDefinition } from '../src/types'
import { ALL_CARD_BORDER_VARIANTS, borderKey } from '../src/card-variants'
import {
  EXPANSION_BORDER_PALETTES,
  formatGameRarity,
  mergeScannedVariants,
  parseGameRarityText,
  rarityCompatibleBorderKeys,
  rarityTextMatchScore,
} from '../src/importer'

assert.equal(ALL_CARD_BORDER_VARIANTS.length, 16, 'Four stackable borders must produce 16 exact variants including Base')
for (const variant of ALL_CARD_BORDER_VARIANTS) {
  assert.ok(EXPANSION_BORDER_PALETTES[variant.key]?.length, `Missing visual palette for ${variant.label}`)
}

assert.equal(formatGameRarity(120_000_000_000_000), '120T')
assert.equal(formatGameRarity(5_600_000_000_000), '5.6T')
assert.equal(formatGameRarity(3_000_000_000_000_000), '3qd')
assert.equal(parseGameRarityText('120T'), 120_000_000_000_000)
assert.equal(parseGameRarityText('5.6T'), 5_600_000_000_000)
assert.ok(rarityTextMatchScore('1201', '120T') < 0.1, 'Tiny OCR should treat a trailing 1 as a plausible T')
assert.ok(rarityTextMatchScore('7.8I', '7.8T') < 0.1, 'Tiny OCR should tolerate I/T suffix confusion')

const collisionCard = { rarity: 120_000_000 } as CardDefinition
const compatible = rarityCompatibleBorderKeys(collisionCard, '1201')
assert.ok(compatible.includes('Galaxy'), '1201 OCR should allow Galaxy when its formatted rarity is 120T')
assert.ok(compatible.includes('Platinum+Crystal'), '1201 OCR should preserve the P+C / Galaxy rarity collision')
assert.ok(!compatible.includes('Platinum+Crystal+Ruby+Galaxy'), 'A border combination whose rarity cannot display as 120T must be excluded')

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

for (const assetId of Object.keys(thumbnails)) {
  const imagePath = `public/card-images/${assetId}.webp`
  assert.ok(existsSync(imagePath), `Missing same-origin cached image ${assetId}`)
  assert.ok(statSync(imagePath).size > 100, `Cached image ${assetId} is empty`)
}
for (const card of cards.filter((entry) => entry.rarity > 0)) {
  assert.ok(card.imageAssetId && existsSync(`public/card-images/${card.imageAssetId}.webp`), `Missing matcher image for ${card.name}`)
}

const sourceHtml = readFileSync('source.html', 'utf8')
const importerSource = readFileSync('src/importer.ts', 'utf8')
const formatSource = readFileSync('src/ui/format.ts', 'utf8')
if (!sourceHtml.includes('@tensorflow/tfjs@4.22.0') || !sourceHtml.includes('@tensorflow-models/mobilenet@2.1.1')) {
  throw new Error('Screenshot importer image-model scripts are missing.')
}
if (!importerSource.includes('model.infer(canvas, true)') || !importerSource.includes('rarity-constrained border')) {
  throw new Error('Screenshot importer is missing the visual matcher or rarity-constrained border selection.')
}
if (!formatSource.includes('./public/card-images/')) {
  throw new Error('Card images are not using the same-origin cache.')
}

console.log(`Importer regression passed with ${Object.keys(thumbnails).length} cached images and rarity-constrained stacked borders.`)
