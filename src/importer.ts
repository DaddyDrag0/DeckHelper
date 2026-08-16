import cards from './data/cards'
import type { BorderName, CardDefinition } from './types'
import { rarityWithBorders } from './engine/stats'
import { ALL_CARD_BORDER_VARIANTS, borderKey, bordersFromKey, canonicalBorders } from './card-variants'
import { thumbnail } from './ui/format'

export interface InventoryScanProgress {
  stage: 'grid' | 'references' | 'ocr' | 'cards'
  current: number
  total: number
  message: string
}

export interface InventoryScanResult {
  cardName: string
  borders: BorderName[]
  quantity: number
  confidence: number
  preview: string
  displayedRarity: string
  method: string
  alternatives: string[]
}

interface Cell {
  x: number
  y: number
  width: number
  height: number
}

interface ArtworkReference {
  card: CardDefinition
  signatures: number[][]
  embeddings: number[][]
}

interface OcrWorker {
  recognize(input: HTMLCanvasElement): Promise<{ data: { text?: string; confidence?: number } }>
  setParameters(parameters: Record<string, string>): Promise<void>
}

declare global {
  interface Window {
    Tesseract?: {
      createWorker(language?: string, oem?: number, options?: { logger?: (message: { status?: string; progress?: number }) => void }): Promise<OcrWorker>
    }
    tf?: { ready(): Promise<void> }
    mobilenet?: { load(options?: Record<string, unknown>): Promise<any> }
  }
}

const usableCards = cards.filter((card) => card.rarity > 0 && card.imageAssetId && thumbnail(card.imageAssetId))
let referencePromise: Promise<ArtworkReference[]> | null = null
let ocrPromise: Promise<OcrWorker | null> | null = null
let imageModelPromise: Promise<any | null> | null = null

function hsvToRgb(hue: number, saturation: number, value: number): [number, number, number] {
  const h = ((hue % 1) + 1) % 1 * 6
  const sector = Math.floor(h)
  const fraction = h - sector
  const p = value * (1 - saturation)
  const q = value * (1 - fraction * saturation)
  const t = value * (1 - (1 - fraction) * saturation)
  const table: Array<[number, number, number]> = [
    [value, t, p], [q, value, p], [p, value, t],
    [p, q, value], [t, p, value], [value, p, q],
  ]
  const rgb = table[sector % 6]
  return rgb.map((channel) => Math.round(channel * 255)) as [number, number, number]
}

const rgb = (red: number, green: number, blue: number): [number, number, number] => [red, green, blue]

const RUBY_PALETTES: Record<string, Array<[number, number, number]>> = {
  Ruby: [rgb(85, 0, 18), rgb(185, 0, 40), rgb(255, 55, 85), rgb(255, 150, 165), rgb(165, 0, 35), rgb(85, 0, 18)],
  'Platinum+Ruby': [rgb(165, 0, 35), rgb(255, 60, 95), rgb(175, 255, 190), rgb(115, 255, 225), rgb(205, 170, 255), rgb(255, 120, 145), rgb(165, 0, 35)],
  'Crystal+Ruby': [rgb(20, 90, 145), rgb(70, 220, 255), rgb(190, 245, 255), rgb(255, 65, 100), rgb(185, 0, 45), rgb(255, 165, 185), rgb(20, 90, 145)],
  'Ruby+Galaxy': [rgb(10, 5, 35), rgb(55, 25, 115), rgb(120, 30, 155), rgb(225, 15, 65), rgb(255, 100, 125), rgb(65, 80, 180), rgb(10, 5, 35)],
  'Platinum+Crystal+Ruby': [rgb(235, 245, 255), rgb(120, 255, 235), rgb(80, 200, 255), rgb(210, 235, 255), rgb(255, 55, 90), rgb(155, 0, 40), rgb(255, 175, 190), rgb(235, 245, 255)],
  'Platinum+Ruby+Galaxy': [rgb(8, 6, 30), rgb(55, 35, 110), rgb(205, 215, 235), rgb(250, 250, 255), rgb(245, 35, 75), rgb(140, 0, 45), rgb(90, 70, 190), rgb(8, 6, 30)],
  'Crystal+Ruby+Galaxy': [rgb(8, 5, 35), rgb(45, 35, 120), rgb(55, 150, 225), rgb(100, 235, 255), rgb(255, 65, 100), rgb(165, 0, 50), rgb(125, 65, 210), rgb(8, 5, 35)],
  'Platinum+Crystal+Ruby+Galaxy': [rgb(5, 5, 25), rgb(50, 25, 105), rgb(75, 100, 220), rgb(90, 235, 255), rgb(240, 250, 255), rgb(255, 75, 105), rgb(150, 0, 45), rgb(175, 105, 255), rgb(215, 225, 245), rgb(5, 5, 25)],
}

const NON_RUBY_COMBOS: Record<string, Array<[number, number, number]>> = {
  'Platinum+Crystal': [rgb(205, 255, 220), rgb(90, 255, 220), rgb(95, 215, 255), rgb(110, 170, 255), rgb(185, 140, 255), rgb(120, 255, 235), rgb(210, 235, 255)],
  'Platinum+Galaxy': [rgb(30, 28, 65), rgb(52, 42, 120), rgb(88, 45, 170), rgb(120, 70, 220), rgb(65, 95, 175), rgb(185, 190, 205), rgb(40, 35, 80)],
  'Crystal+Galaxy': [rgb(10, 8, 38), rgb(30, 22, 92), rgb(72, 42, 165), rgb(78, 115, 205), rgb(65, 185, 225), rgb(105, 70, 205), rgb(150, 185, 235), rgb(10, 8, 38)],
  'Platinum+Crystal+Galaxy': [rgb(8, 8, 32), rgb(35, 25, 95), rgb(80, 45, 185), rgb(70, 110, 235), rgb(95, 235, 245), rgb(235, 245, 255), rgb(190, 255, 185), rgb(145, 95, 255), rgb(8, 8, 32)],
}

function paletteForBorderKey(key: string): Array<[number, number, number]> {
  if (key === 'Platinum') return Array.from({ length: 11 }, (_, index) => hsvToRgb((index * 0.1) % 1, 0.3, 1))
  if (key === 'Crystal') return Array.from({ length: 4 }, (_, index) => hsvToRgb(0.6 - index * 0.05, 0.5, 1))
  if (key === 'Galaxy') {
    // Single Galaxy is continuously replaced by the game's Charge gradient. A denser hue arc
    // is deliberately used here so matching does not depend on the exact animation frame.
    return Array.from({ length: 13 }, (_, index) => hsvToRgb(0.5 + index * (0.5 / 12), 0.8, 1))
  }
  return RUBY_PALETTES[key] || NON_RUBY_COMBOS[key] || [rgb(40, 40, 40)]
}

export const EXPANSION_BORDER_PALETTES = Object.fromEntries(
  ALL_CARD_BORDER_VARIANTS.map((variant) => [variant.key, paletteForBorderKey(variant.key)]),
) as Record<string, Array<[number, number, number]>>

export function formatGameRarity(value: number): string {
  const rarity = Math.max(0, Math.floor(value))
  const units: Array<[number, string]> = [[1e18, 'qt'], [1e15, 'qd'], [1e12, 'T'], [1e9, 'B']]
  for (const [threshold, suffix] of units) {
    if (rarity < threshold) continue
    const scaled = rarity / threshold
    if (scaled >= 10) return `${Math.floor(scaled)}${suffix}`
    if (scaled === Math.floor(scaled)) return `${Math.floor(scaled)}${suffix}`
    return `${scaled.toFixed(1)}${suffix}`
  }
  return rarity.toLocaleString('en-US')
}

function normalizeRarityText(value: string): string {
  return value
    .replace(/\s+/g, '')
    .replace(/[Oo]/g, '0')
    .replace(/Q[Dd]/gi, 'qd')
    .replace(/Q[Tt]/gi, 'qt')
    .replace(/[^0-9.,A-Za-z]/g, '')
}

function comparisonRarityText(value: string): string {
  return normalizeRarityText(value).replace(/,/g, '').toLowerCase()
}

function raritySubstitutionCost(left: string, right: string, atEnd: boolean): number {
  if (left === right) return 0
  const pair = `${left}${right}`
  if (['1i', 'i1', '1l', 'l1', '0o', 'o0', '5s', 's5'].includes(pair)) return 0.12
  if (atEnd && ['1t', 't1', '7t', 't7', 'it', 'ti', 'lt', 'tl', '8b', 'b8'].includes(pair)) return 0.12
  if (atEnd && ['9q', 'q9', '0d', 'd0'].includes(pair)) return 0.28
  return 1
}

function rarityGapCost(character: string): number {
  return character === '.' || character === ',' ? 0.22 : 0.9
}

export function rarityTextMatchScore(observed: string, expected: string): number {
  const left = comparisonRarityText(observed)
  const right = comparisonRarityText(expected)
  if (!left || !right) return Number.POSITIVE_INFINITY
  if (left === right) return 0

  const rows = left.length + 1
  const columns = right.length + 1
  const matrix = Array.from({ length: rows }, () => Array<number>(columns).fill(0))
  for (let row = 1; row < rows; row++) matrix[row][0] = matrix[row - 1][0] + rarityGapCost(left[row - 1])
  for (let column = 1; column < columns; column++) matrix[0][column] = matrix[0][column - 1] + rarityGapCost(right[column - 1])

  for (let row = 1; row < rows; row++) {
    for (let column = 1; column < columns; column++) {
      const atEnd = row === left.length || column === right.length
      const substitution = matrix[row - 1][column - 1] + raritySubstitutionCost(left[row - 1], right[column - 1], atEnd)
      const deletion = matrix[row - 1][column] + rarityGapCost(left[row - 1])
      const insertion = matrix[row][column - 1] + rarityGapCost(right[column - 1])
      matrix[row][column] = Math.min(substitution, deletion, insertion)
    }
  }

  return matrix[left.length][right.length] / Math.max(1, left.length, right.length)
}

export function parseGameRarityText(value: string): number {
  const text = normalizeRarityText(value)
    .replace(/[lI|]/g, '1')
    .replace(/,/g, '')
  const match = text.match(/(\d+(?:\.\d+)?)(qt|qd|[TBMK])?/i)
  if (!match) return 0
  const amount = Number(match[1])
  if (!Number.isFinite(amount)) return 0
  const suffix = (match[2] || '').toLowerCase()
  const multiplier = suffix === 'qt' ? 1e18
    : suffix === 'qd' ? 1e15
      : suffix === 't' ? 1e12
        : suffix === 'b' ? 1e9
          : suffix === 'm' ? 1e6
            : suffix === 'k' ? 1e3
              : 1
  return amount * multiplier
}

function imageToCanvas(image: CanvasImageSource, width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width))
  canvas.height = Math.max(1, Math.round(height))
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('Canvas is unavailable in this browser.')
  context.drawImage(image, 0, 0, canvas.width, canvas.height)
  return canvas
}

function loadImageSource(source: string, crossOrigin = false): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.decoding = 'async'
    if (crossOrigin) image.crossOrigin = 'anonymous'
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Image could not be loaded.'))
    image.src = source
  })
}

async function loadImageFile(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file)
  try {
    return await loadImageSource(url)
  } finally {
    URL.revokeObjectURL(url)
  }
}

async function getImageModel(onProgress: (progress: InventoryScanProgress) => void): Promise<any | null> {
  if (imageModelPromise) return imageModelPromise
  if (!window.tf || !window.mobilenet) return null
  imageModelPromise = (async () => {
    onProgress({ stage: 'references', current: 0, total: usableCards.length, message: 'Loading crop-tolerant image matcher' })
    await window.tf!.ready()
    return window.mobilenet!.load({ version: 2, alpha: 1.0 })
  })().catch(() => null)
  return imageModelPromise
}

function createFeatureCanvas(image: CanvasImageSource, sx: number, sy: number, sw: number, sh: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = 224
  canvas.height = 224
  const context = canvas.getContext('2d')!
  context.fillStyle = '#000'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.drawImage(image, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height)
  return canvas
}

async function imageEmbedding(model: any, canvas: HTMLCanvasElement): Promise<number[]> {
  const tensor = model.infer(canvas, true)
  try {
    const values = Array.from(await tensor.data()) as number[]
    const magnitude = Math.sqrt(values.reduce((total, value) => total + value * value, 0)) || 1
    return values.map((value) => value / magnitude)
  } finally {
    if (typeof tensor.dispose === 'function') tensor.dispose()
  }
}

function embeddingDistance(left: number[], right: number[]): number {
  const length = Math.min(left.length, right.length)
  let similarity = 0
  for (let index = 0; index < length; index++) similarity += left[index] * right[index]
  return 1 - similarity
}

function bestPairwiseDistance(
  left: number[][],
  right: number[][],
  metric: (first: number[], second: number[]) => number,
): number {
  const distances: number[] = []
  for (const first of left) {
    for (const second of right) distances.push(metric(first, second))
  }
  if (!distances.length) return Number.POSITIVE_INFINITY
  distances.sort((first, second) => first - second)
  if (distances.length === 1) return distances[0]
  return distances[0] * 0.78 + distances[1] * 0.22
}

function signatureFromCanvas(canvas: HTMLCanvasElement): number[] {
  const outputWidth = 30
  const outputHeight = 22
  const reduced = document.createElement('canvas')
  reduced.width = outputWidth
  reduced.height = outputHeight
  const context = reduced.getContext('2d', { willReadFrequently: true })!
  context.drawImage(canvas, 0, 0, outputWidth, outputHeight)
  const data = context.getImageData(0, 0, outputWidth, outputHeight).data
  let average = 0
  for (let index = 0; index < data.length; index += 4) average += (data[index] + data[index + 1] + data[index + 2]) / 3
  average = average / Math.max(1, data.length / 4) || 1
  const signature: number[] = []
  for (let index = 0; index < data.length; index += 4) {
    const red = data[index] / 255
    const green = data[index + 1] / 255
    const blue = data[index + 2] / 255
    const total = red + green + blue + 0.08
    const luminance = ((data[index] + data[index + 1] + data[index + 2]) / 3) / average
    signature.push(red / total, green / total, blue / total, Math.min(2, luminance) * 0.38)
  }
  return signature
}

function signatureDistance(left: number[], right: number[]): number {
  const length = Math.min(left.length, right.length)
  let total = 0
  for (let index = 0; index < length; index++) {
    const difference = left[index] - right[index]
    total += difference * difference
  }
  return total / Math.max(1, length)
}

function artworkCanvases(image: CanvasImageSource, sourceWidth: number, sourceHeight: number): HTMLCanvasElement[] {
  return [
    createFeatureCanvas(image, 0, 0, sourceWidth, sourceHeight),
    createFeatureCanvas(image, sourceWidth * 0.06, sourceHeight * 0.03, sourceWidth * 0.88, sourceHeight * 0.76),
    createFeatureCanvas(image, sourceWidth * 0.11, sourceHeight * 0.07, sourceWidth * 0.78, sourceHeight * 0.66),
  ]
}

async function getArtworkReferences(onProgress: (progress: InventoryScanProgress) => void): Promise<ArtworkReference[]> {
  if (referencePromise) return referencePromise
  referencePromise = (async () => {
    const references: ArtworkReference[] = []
    const model = await getImageModel(onProgress)
    const batchSize = 6
    for (let start = 0; start < usableCards.length; start += batchSize) {
      const batch = usableCards.slice(start, start + batchSize)
      const loaded = await Promise.all(batch.map(async (card) => {
        try {
          const source = thumbnail(card.imageAssetId)
          const image = await loadImageSource(source)
          const canvases = artworkCanvases(image, image.naturalWidth || image.width, image.naturalHeight || image.height)
          const signatures = canvases.map((canvas) => signatureFromCanvas(canvas))
          const embeddings: number[][] = []
          if (model) {
            for (const canvas of canvases) embeddings.push(await imageEmbedding(model, canvas))
          }
          return { card, signatures, embeddings }
        } catch {
          return null
        }
      }))
      for (const reference of loaded) if (reference) references.push(reference)
      onProgress({
        stage: 'references',
        current: Math.min(start + batch.length, usableCards.length),
        total: usableCards.length,
        message: `Preparing card artwork ${Math.min(start + batch.length, usableCards.length)}/${usableCards.length}`,
      })
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    }
    if (references.length !== usableCards.length) {
      throw new Error(`Only ${references.length}/${usableCards.length} card reference images loaded. Refresh and try again; DeckHelper will not guess from an incomplete library.`)
    }
    return references
  })()
  return referencePromise
}

function stripBrightness(data: Uint8ClampedArray, width: number, height: number, axis: 'x' | 'y', coordinate: number): number {
  const center = Math.max(0, Math.min(axis === 'x' ? width - 1 : height - 1, Math.round(coordinate)))
  let total = 0
  let count = 0
  for (let offset = -1; offset <= 1; offset++) {
    const line = Math.max(0, Math.min(axis === 'x' ? width - 1 : height - 1, center + offset))
    const crossLength = axis === 'x' ? height : width
    for (let cross = 0; cross < crossLength; cross += 2) {
      const x = axis === 'x' ? line : cross
      const y = axis === 'x' ? cross : line
      const pixel = (y * width + x) * 4
      total += Math.max(data[pixel], data[pixel + 1], data[pixel + 2]) / 255
      count += 1
    }
  }
  return total / Math.max(1, count)
}

export function detectInventoryGrid(image: HTMLImageElement): Cell[] {
  const width = image.naturalWidth || image.width
  const height = image.naturalHeight || image.height
  const canvas = imageToCanvas(image, width, height)
  const context = canvas.getContext('2d', { willReadFrequently: true })!
  const pixels = context.getImageData(0, 0, width, height).data
  const gridCandidates: Array<{ score: number; columns: number; rows: number }> = []

  for (let columns = 1; columns <= 12; columns++) {
    for (let rows = 1; rows <= 12; rows++) {
      if (columns * rows < 2) continue
      const cellWidth = width / columns
      const cellHeight = height / rows
      if (Math.min(cellWidth, cellHeight) < 30 || Math.max(cellWidth, cellHeight) > 300) continue
      const aspect = cellWidth / cellHeight
      if (aspect < 0.76 || aspect > 1.32) continue
      const vertical = columns > 1
        ? Array.from({ length: columns - 1 }, (_, index) => stripBrightness(pixels, width, height, 'x', (index + 1) * cellWidth)).reduce((sum, value) => sum + value, 0) / (columns - 1)
        : 0.5
      const horizontal = rows > 1
        ? Array.from({ length: rows - 1 }, (_, index) => stripBrightness(pixels, width, height, 'y', (index + 1) * cellHeight)).reduce((sum, value) => sum + value, 0) / (rows - 1)
        : 0.5
      const score = (vertical + horizontal) / 2 + Math.abs(Math.log(aspect)) * 0.22
      gridCandidates.push({ score, columns, rows })
    }
  }

  // A compact inventory can make every second separator look slightly darker than the
  // real per-card separators. That caused a true 6x4 grid to be mistaken for 3x2,
  // grouping four cards into every scan cell. Start with the strongest coarse grid,
  // then prefer a finer integer subdivision when its separator score is nearly as good.
  const rankedGrids = gridCandidates.sort((left, right) => left.score - right.score)
  const coarseBest = rankedGrids[0] || null
  let best = coarseBest
  if (coarseBest) {
    const refinementMargin = Math.min(0.055, Math.max(0.028, coarseBest.score * 0.22))
    const refinements = rankedGrids.filter((candidate) => {
      if (candidate.score > coarseBest.score + refinementMargin) return false
      if (candidate.columns % coarseBest.columns !== 0 || candidate.rows % coarseBest.rows !== 0) return false
      const columnFactor = candidate.columns / coarseBest.columns
      const rowFactor = candidate.rows / coarseBest.rows
      if (columnFactor > 3 || rowFactor > 3) return false
      return columnFactor >= 1 && rowFactor >= 1
    })
    refinements.sort((left, right) => {
      const cellDifference = right.columns * right.rows - left.columns * left.rows
      return cellDifference || left.score - right.score
    })
    best = refinements[0] || coarseBest
  }

  if (!best || best.score > 0.72) throw new Error('Could not identify the inventory card grid. Crop the screenshot to the cards and try again.')

  const cells: Cell[] = []
  for (let row = 0; row < best.rows; row++) {
    for (let column = 0; column < best.columns; column++) {
      const x1 = Math.round(column * width / best.columns)
      const x2 = Math.round((column + 1) * width / best.columns)
      const y1 = Math.round(row * height / best.rows)
      const y2 = Math.round((row + 1) * height / best.rows)
      const cell = { x: x1, y: y1, width: x2 - x1, height: y2 - y1 }
      const sample = document.createElement('canvas')
      sample.width = 12
      sample.height = 12
      const sampleContext = sample.getContext('2d', { willReadFrequently: true })!
      sampleContext.drawImage(image, cell.x + cell.width * 0.12, cell.y + cell.height * 0.12, cell.width * 0.76, cell.height * 0.62, 0, 0, 12, 12)
      const sampleData = sampleContext.getImageData(0, 0, 12, 12).data
      let brightness = 0
      let brightnessSquared = 0
      let colorfulPixels = 0
      const pixelCount = Math.max(1, sampleData.length / 4)
      for (let index = 0; index < sampleData.length; index += 4) {
        const red = sampleData[index]
        const green = sampleData[index + 1]
        const blue = sampleData[index + 2]
        const maximum = Math.max(red, green, blue)
        const minimum = Math.min(red, green, blue)
        brightness += maximum
        brightnessSquared += maximum * maximum
        if (maximum > 24 && maximum - minimum > 15) colorfulPixels += 1
      }
      brightness /= pixelCount
      const variance = Math.max(0, brightnessSquared / pixelCount - brightness * brightness)
      const deviation = Math.sqrt(variance)
      if (brightness > 8 || deviation > 12 || colorfulPixels / pixelCount > 0.025) cells.push(cell)
    }
  }
  if (!cells.length) throw new Error('The grid was found, but no card artwork was detected.')
  return cells
}

function cellArtworkCanvases(image: HTMLImageElement, cell: Cell): HTMLCanvasElement[] {
  return [
    createFeatureCanvas(
      image,
      cell.x + cell.width * 0.05,
      cell.y + cell.height * 0.035,
      cell.width * 0.90,
      cell.height * 0.73,
    ),
    createFeatureCanvas(
      image,
      cell.x + cell.width * 0.10,
      cell.y + cell.height * 0.055,
      cell.width * 0.80,
      cell.height * 0.67,
    ),
    createFeatureCanvas(
      image,
      cell.x + cell.width * 0.14,
      cell.y + cell.height * 0.08,
      cell.width * 0.72,
      cell.height * 0.59,
    ),
  ]
}

interface HsvPixel {
  r: number
  g: number
  b: number
  saturation: number
  value: number
}

function rgbToHsv(red: number, green: number, blue: number): { saturation: number; value: number } {
  const r = red / 255
  const g = green / 255
  const b = blue / 255
  const maximum = Math.max(r, g, b)
  const minimum = Math.min(r, g, b)
  const difference = maximum - minimum
  return { saturation: maximum ? difference / maximum : 0, value: maximum }
}

function sampleBorderPixels(image: HTMLImageElement, cell: Cell): HsvPixel[] {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(cell.width))
  canvas.height = Math.max(1, Math.round(cell.height))
  const context = canvas.getContext('2d', { willReadFrequently: true })!
  context.drawImage(image, cell.x, cell.y, cell.width, cell.height, 0, 0, canvas.width, canvas.height)
  const { data, width, height } = context.getImageData(0, 0, canvas.width, canvas.height)
  const thickness = Math.max(2, Math.round(Math.min(width, height) * 0.055))
  const result: HsvPixel[] = []
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (x >= thickness && x < width - thickness && y >= thickness && y < height - thickness) continue
      if (x > width * 0.66 && y < height * 0.24) continue
      if (x > width * 0.38 && y > height * 0.70) continue
      const offset = (y * width + x) * 4
      const red = data[offset]
      const green = data[offset + 1]
      const blue = data[offset + 2]
      const hsv = rgbToHsv(red, green, blue)
      result.push({ r: red, g: green, b: blue, ...hsv })
    }
  }
  return result
}

function normalizedRgbDistance(pixel: HsvPixel, color: [number, number, number]): number {
  const red = pixel.r - color[0]
  const green = pixel.g - color[1]
  const blue = pixel.b - color[2]
  return Math.sqrt(red * red + green * green + blue * blue) / 441.673
}

function visualBorderScores(image: HTMLImageElement, cell: Cell): Map<string, number> {
  const pixels = sampleBorderPixels(image, cell)
  const colorful = pixels.filter((pixel) => pixel.value > 0.24 && pixel.saturation > 0.10)
  const colorfulRatio = colorful.length / Math.max(1, pixels.length)
  const scores = new Map<string, number>()
  scores.set('', colorfulRatio * 1.15)
  for (const variant of ALL_CARD_BORDER_VARIANTS) {
    if (!variant.key) continue
    const palette = EXPANSION_BORDER_PALETTES[variant.key]
    const candidatePixels = colorful.length ? colorful : pixels
    const distances = candidatePixels
      .map((pixel) => Math.min(...palette.map((color) => normalizedRgbDistance(pixel, color))))
      .sort((left, right) => left - right)
    const keep = Math.max(1, Math.floor(distances.length * 0.68))
    const fit = distances.slice(0, keep).reduce((sum, value) => sum + value, 0) / keep
    const colorPresencePenalty = Math.max(0, 0.11 - colorfulRatio) * 1.6
    scores.set(variant.key, fit + colorPresencePenalty)
  }
  return scores
}

async function getOcrWorker(onProgress: (progress: InventoryScanProgress) => void): Promise<OcrWorker | null> {
  if (ocrPromise) return ocrPromise
  ocrPromise = (async () => {
    if (!window.Tesseract) return null
    try {
      const worker = await window.Tesseract.createWorker('eng', 1, {
        logger: (message) => {
          if (message.status && typeof message.progress === 'number') {
            onProgress({ stage: 'ocr', current: Math.round(message.progress * 100), total: 100, message: `${message.status} ${Math.round(message.progress * 100)}%` })
          }
        },
      })
      await worker.setParameters({
        tessedit_pageseg_mode: '7',
        tessedit_char_whitelist: 'xX0123456789.,KMBTqdQt',
        preserve_interword_spaces: '1',
      })
      return worker
    } catch {
      return null
    }
  })()
  return ocrPromise
}

function rarityCanvas(image: HTMLImageElement, cell: Cell, binary: boolean): HTMLCanvasElement {
  const sx = cell.x + cell.width * 0.38
  const sy = cell.y + cell.height * 0.72
  const sw = cell.width * 0.60
  const sh = cell.height * 0.25
  const scale = 7
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(sw * scale))
  canvas.height = Math.max(1, Math.round(sh * scale))
  const context = canvas.getContext('2d', { willReadFrequently: true })!
  context.imageSmoothingEnabled = false
  context.drawImage(image, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height)
  if (binary) {
    const imageData = context.getImageData(0, 0, canvas.width, canvas.height)
    for (let index = 0; index < imageData.data.length; index += 4) {
      const red = imageData.data[index]
      const green = imageData.data[index + 1]
      const blue = imageData.data[index + 2]
      const maximum = Math.max(red, green, blue)
      const minimum = Math.min(red, green, blue)
      const luminance = red * 0.299 + green * 0.587 + blue * 0.114
      const white = luminance > 105 && maximum - minimum < 125 ? 255 : 0
      imageData.data[index] = white
      imageData.data[index + 1] = white
      imageData.data[index + 2] = white
      imageData.data[index + 3] = 255
    }
    context.putImageData(imageData, 0, 0)
  }
  return canvas
}

async function recognizeRarity(worker: OcrWorker | null, image: HTMLImageElement, cell: Cell): Promise<string> {
  if (!worker) return ''
  const raw = await worker.recognize(rarityCanvas(image, cell, false))
  let text = String(raw.data.text || '').trim()
  if (!parseGameRarityText(text)) {
    const binary = await worker.recognize(rarityCanvas(image, cell, true))
    text = String(binary.data.text || '').trim() || text
  }
  return normalizeRarityText(text)
}

function quantityCanvas(image: HTMLImageElement, cell: Cell): HTMLCanvasElement {
  const sx = cell.x + cell.width * 0.66
  const sy = cell.y + cell.height * 0.01
  const sw = cell.width * 0.32
  const sh = cell.height * 0.23
  const scale = 8
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(sw * scale))
  canvas.height = Math.max(1, Math.round(sh * scale))
  const context = canvas.getContext('2d', { willReadFrequently: true })!
  context.imageSmoothingEnabled = false
  context.drawImage(image, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height)
  const imageData = context.getImageData(0, 0, canvas.width, canvas.height)
  for (let index = 0; index < imageData.data.length; index += 4) {
    const red = imageData.data[index]
    const green = imageData.data[index + 1]
    const blue = imageData.data[index + 2]
    const luminance = red * 0.299 + green * 0.587 + blue * 0.114
    const white = luminance > 145 ? 255 : 0
    imageData.data[index] = white
    imageData.data[index + 1] = white
    imageData.data[index + 2] = white
    imageData.data[index + 3] = 255
  }
  context.putImageData(imageData, 0, 0)
  return canvas
}

async function recognizeQuantity(worker: OcrWorker | null, image: HTMLImageElement, cell: Cell): Promise<number> {
  if (!worker) return 1
  try {
    const result = await worker.recognize(quantityCanvas(image, cell))
    const text = String(result.data.text || '').replace(/\s+/g, '')
    const match = text.match(/[xX]?(\d{1,3})/)
    const quantity = match ? Number(match[1]) : 1
    return Number.isInteger(quantity) && quantity >= 2 && quantity <= 999 ? quantity : 1
  } catch {
    return 1
  }
}

function cropPreview(image: HTMLImageElement, cell: Cell): string {
  const canvas = document.createElement('canvas')
  canvas.width = 110
  canvas.height = 110
  const context = canvas.getContext('2d')!
  context.drawImage(image, cell.x, cell.y, cell.width, cell.height, 0, 0, 110, 110)
  return canvas.toDataURL('image/jpeg', 0.82)
}

interface RarityVariantMatch {
  expectedText: string
  score: number
  exact: boolean
}

const RARITY_CONSTRAINT_LIMIT = 0.16
const RARITY_TIE_MARGIN = 0.035

function rarityVariantMatch(card: CardDefinition, borders: BorderName[], displayedText: string): RarityVariantMatch {
  const expectedText = formatGameRarity(rarityWithBorders(card, borders))
  if (!displayedText) return { expectedText, score: Number.POSITIVE_INFINITY, exact: false }
  const score = rarityTextMatchScore(displayedText, expectedText)
  return { expectedText, score, exact: score === 0 }
}

function rarityMatchesForCard(card: CardDefinition, displayedText: string) {
  return ALL_CARD_BORDER_VARIANTS.map((variant) => ({
    variant,
    rarity: rarityVariantMatch(card, variant.borders, displayedText),
  }))
}

export function rarityCompatibleBorderKeys(card: CardDefinition, displayedText: string): string[] {
  if (!displayedText) return []
  const matches = rarityMatchesForCard(card, displayedText)
  const best = Math.min(...matches.map((candidate) => candidate.rarity.score))
  if (!Number.isFinite(best) || best > RARITY_CONSTRAINT_LIMIT) return []
  const limit = Math.min(RARITY_CONSTRAINT_LIMIT, best + RARITY_TIE_MARGIN)
  return matches.filter((candidate) => candidate.rarity.score <= limit).map((candidate) => candidate.variant.key)
}

async function matchCell(
  image: HTMLImageElement,
  cell: Cell,
  references: ArtworkReference[],
  displayedRarity: string,
  model: any | null,
): Promise<Omit<InventoryScanResult, 'quantity' | 'preview'>> {
  const canvases = cellArtworkCanvases(image, cell)
  const signatures = canvases.map((canvas) => signatureFromCanvas(canvas))
  const embeddings: number[][] = []
  if (model) {
    for (const canvas of canvases) embeddings.push(await imageEmbedding(model, canvas))
  }

  const usingEmbeddings = embeddings.length > 0 && references.every((reference) => reference.embeddings.length > 0)
  const artworkRanking = references
    .map((reference) => {
      const distance = usingEmbeddings
        ? bestPairwiseDistance(embeddings, reference.embeddings, embeddingDistance)
        : bestPairwiseDistance(signatures, reference.signatures, signatureDistance)
      return { reference, distance }
    })
    .sort((left, right) => left.distance - right.distance)

  if (!artworkRanking.length) throw new Error('No card artwork references were available.')

  const bestArt = artworkRanking[0].distance
  const visualScores = visualBorderScores(image, cell)
  const bestVisual = Math.min(...visualScores.values())
  const closeThreshold = usingEmbeddings
    ? bestArt + 0.085
    : bestArt * 1.35 + 0.002
  const closeVisuals = artworkRanking.filter((candidate, index) => index < 80 && candidate.distance <= closeThreshold)
  if (!closeVisuals.length) closeVisuals.push(artworkRanking[0])

  const identityCandidates = closeVisuals.map((art) => {
    const rarityMatches = rarityMatchesForCard(art.reference.card, displayedRarity)
    const bestRarityScore = Math.min(...rarityMatches.map((candidate) => candidate.rarity.score))
    let score = art.distance
    // Rarity can break a close visual tie, but it is never allowed to rescue unrelated artwork.
    if (displayedRarity && bestRarityScore <= RARITY_CONSTRAINT_LIMIT) {
      score -= usingEmbeddings ? 0.018 : Math.max(0.0003, bestArt * 0.04)
    }
    return { ...art, score, bestRarityScore }
  }).sort((left, right) => left.score - right.score)

  const chosenIdentity = identityCandidates[0]
  const allBorderCandidates = rarityMatchesForCard(chosenIdentity.reference.card, displayedRarity).map((candidate) => {
    const visual = (visualScores.get(candidate.variant.key) ?? 1) - bestVisual
    return { ...candidate, visual }
  })
  const bestRarityScore = Math.min(...allBorderCandidates.map((candidate) => candidate.rarity.score))
  const rarityConstrained = Boolean(displayedRarity)
    && Number.isFinite(bestRarityScore)
    && bestRarityScore <= RARITY_CONSTRAINT_LIMIT
  const rarityLimit = Math.min(RARITY_CONSTRAINT_LIMIT, bestRarityScore + RARITY_TIE_MARGIN)
  const allowedBorders = rarityConstrained
    ? allBorderCandidates.filter((candidate) => candidate.rarity.score <= rarityLimit)
    : allBorderCandidates

  allowedBorders.sort((left, right) => {
    if (rarityConstrained) {
      const leftScore = left.visual + left.rarity.score * 0.18
      const rightScore = right.visual + right.rarity.score * 0.18
      return leftScore - rightScore
    }
    return left.visual - right.visual
  })
  const chosenBorder = allowedBorders[0]

  const nextIdentity = identityCandidates[1]
  const visualGap = nextIdentity ? Math.max(0, nextIdentity.distance - chosenIdentity.distance) : 0.08
  const imageQuality = usingEmbeddings
    ? Math.max(0, Math.min(1, 1 - chosenIdentity.distance))
    : Math.max(0, Math.min(1, visualGap / Math.max(0.0001, nextIdentity?.distance ?? chosenIdentity.distance + 0.01)))
  const rarityAdjustment = rarityConstrained ? 12 : displayedRarity ? -8 : 0
  const confidence = Math.round(Math.max(16, Math.min(98,
    30
    + imageQuality * 46
    + (usingEmbeddings ? Math.min(16, visualGap * 260) : Math.min(18, visualGap * 1800))
    + rarityAdjustment
  )))

  const alternatives = [...new Set(artworkRanking
    .filter((candidate) => candidate.reference.card.name !== chosenIdentity.reference.card.name)
    .slice(0, 10)
    .map((candidate) => candidate.reference.card.name))].slice(0, 3)
  const methodPrefix = usingEmbeddings ? 'MobileNet artwork' : 'Artwork fallback'
  const correctedRarity = rarityConstrained ? chosenBorder.rarity.expectedText : displayedRarity
  const method = rarityConstrained
    ? `${methodPrefix} + rarity-constrained border + game border palette`
    : displayedRarity
      ? `${methodPrefix} + unclear rarity + game border palette (review border)`
      : `${methodPrefix} + game border palette (review border)`

  return {
    cardName: chosenIdentity.reference.card.name,
    borders: canonicalBorders(chosenBorder.variant.borders),
    confidence,
    displayedRarity: correctedRarity,
    method,
    alternatives,
  }
}

export async function scanInventoryScreenshot(
  file: File,
  onProgress: (progress: InventoryScanProgress) => void = () => {},
): Promise<InventoryScanResult[]> {
  const image = await loadImageFile(file)
  onProgress({ stage: 'grid', current: 0, total: 1, message: 'Finding the inventory grid' })
  const cells = detectInventoryGrid(image)
  const references = await getArtworkReferences(onProgress)
  const model = await getImageModel(onProgress)
  const worker = await getOcrWorker(onProgress)
  const results: InventoryScanResult[] = []

  for (let index = 0; index < cells.length; index++) {
    const cell = cells[index]
    onProgress({ stage: 'cards', current: index, total: cells.length, message: `Reading card ${index + 1}/${cells.length}` })
    const displayedRarity = await recognizeRarity(worker, image, cell)
    const match = await matchCell(image, cell, references, displayedRarity, model)
    const quantity = await recognizeQuantity(worker, image, cell)
    results.push({ ...match, quantity, preview: cropPreview(image, cell) })
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  }

  onProgress({ stage: 'cards', current: cells.length, total: cells.length, message: `${cells.length} card slots detected` })
  return results
}

export function mergeScannedVariants(
  existing: Array<{ cardName: string; borders: BorderName[]; quantity: number }>,
  scans: Array<Pick<InventoryScanResult, 'cardName' | 'borders' | 'quantity'>>,
): Array<{ cardName: string; borders: BorderName[]; quantity: number }> {
  const merged = new Map<string, { cardName: string; borders: BorderName[]; quantity: number }>()
  for (const entry of existing) {
    const borders = canonicalBorders(entry.borders)
    const key = `${entry.cardName}\u0000${borderKey(borders)}`
    const current = merged.get(key)
    if (current) current.quantity += Math.max(1, Math.floor(entry.quantity || 1))
    else merged.set(key, { cardName: entry.cardName, borders, quantity: Math.max(1, Math.floor(entry.quantity || 1)) })
  }
  for (const scan of scans) {
    const borders = canonicalBorders(scan.borders)
    const key = `${scan.cardName}\u0000${borderKey(borders)}`
    const current = merged.get(key)
    const quantity = Math.max(1, Math.floor(scan.quantity || 1))
    if (current) current.quantity += quantity
    else merged.set(key, { cardName: scan.cardName, borders, quantity })
  }
  return [...merged.values()]
}

export { bordersFromKey }
