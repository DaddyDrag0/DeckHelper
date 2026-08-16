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
  signature: number[]
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
  }
}

const usableCards = cards.filter((card) => card.rarity > 0 && card.imageAssetId && thumbnail(card.imageAssetId))
let referencePromise: Promise<ArtworkReference[]> | null = null
let ocrPromise: Promise<OcrWorker | null> | null = null

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
    .replace(/[lI|]/g, '1')
    .replace(/Q[Dd]/g, 'qd')
    .replace(/Q[Tt]/g, 'qt')
    .replace(/[^0-9.,A-Za-z]/g, '')
}

export function parseGameRarityText(value: string): number {
  const text = normalizeRarityText(value).replace(/,/g, '')
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

function artworkCanvas(image: CanvasImageSource, sourceWidth: number, sourceHeight: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = 160
  canvas.height = 120
  const context = canvas.getContext('2d', { willReadFrequently: true })!
  context.drawImage(
    image,
    sourceWidth * 0.08,
    sourceHeight * 0.06,
    sourceWidth * 0.84,
    sourceHeight * 0.68,
    0,
    0,
    canvas.width,
    canvas.height,
  )
  return canvas
}

async function getArtworkReferences(onProgress: (progress: InventoryScanProgress) => void): Promise<ArtworkReference[]> {
  if (referencePromise) return referencePromise
  referencePromise = (async () => {
    const references: ArtworkReference[] = []
    const batchSize = 8
    for (let start = 0; start < usableCards.length; start += batchSize) {
      const batch = usableCards.slice(start, start + batchSize)
      const loaded = await Promise.all(batch.map(async (card) => {
        try {
          const source = thumbnail(card.imageAssetId)
          const image = await loadImageSource(source, true)
          const canvas = artworkCanvas(image, image.naturalWidth || image.width, image.naturalHeight || image.height)
          return { card, signature: signatureFromCanvas(canvas) }
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
    if (!references.length) throw new Error('Card reference images could not be loaded. Check your connection and try again.')
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
  let best: { score: number; columns: number; rows: number } | null = null

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
      if (!best || score < best.score) best = { score, columns, rows }
    }
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
      for (let index = 0; index < sampleData.length; index += 4) brightness += Math.max(sampleData[index], sampleData[index + 1], sampleData[index + 2])
      brightness /= Math.max(1, sampleData.length / 4)
      if (brightness > 20) cells.push(cell)
    }
  }
  if (!cells.length) throw new Error('The grid was found, but no card artwork was detected.')
  return cells
}

function cellArtworkSignature(image: HTMLImageElement, cell: Cell): number[] {
  const canvas = document.createElement('canvas')
  canvas.width = 160
  canvas.height = 120
  const context = canvas.getContext('2d', { willReadFrequently: true })!
  context.drawImage(
    image,
    cell.x + cell.width * 0.08,
    cell.y + cell.height * 0.06,
    cell.width * 0.84,
    cell.height * 0.68,
    0,
    0,
    canvas.width,
    canvas.height,
  )
  return signatureFromCanvas(canvas)
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

function rarityPenalty(card: CardDefinition, borders: BorderName[], displayedText: string): { penalty: number; exact: boolean } {
  if (!displayedText) return { penalty: 0.22, exact: false }
  const expectedRarity = rarityWithBorders(card, borders)
  const expectedText = normalizeRarityText(formatGameRarity(expectedRarity))
  const recognized = normalizeRarityText(displayedText)
  if (recognized.toLowerCase() === expectedText.toLowerCase()) return { penalty: -0.35, exact: true }
  const parsed = parseGameRarityText(recognized)
  if (!parsed) return { penalty: 0.3, exact: false }
  return { penalty: Math.min(2.5, Math.abs(Math.log(expectedRarity / Math.max(1, parsed)))), exact: false }
}

function matchCell(
  image: HTMLImageElement,
  cell: Cell,
  references: ArtworkReference[],
  displayedRarity: string,
): Omit<InventoryScanResult, 'quantity' | 'preview'> {
  const signature = cellArtworkSignature(image, cell)
  const artworkRanking = references
    .map((reference) => ({ reference, distance: signatureDistance(signature, reference.signature) }))
    .sort((left, right) => left.distance - right.distance)
  const shortlist = artworkRanking.slice(0, Math.min(10, artworkRanking.length))
  const visualScores = visualBorderScores(image, cell)
  const bestVisual = Math.min(...visualScores.values())
  const bestArt = shortlist[0]?.distance ?? 0
  const candidates: Array<{
    card: CardDefinition
    borders: BorderName[]
    score: number
    artDistance: number
    exactRarity: boolean
  }> = []

  shortlist.forEach((art, artIndex) => {
    const relativeArt = bestArt > 0 ? Math.max(0, (art.distance - bestArt) / bestArt) : artIndex * 0.1
    for (const variant of ALL_CARD_BORDER_VARIANTS) {
      const rarity = rarityPenalty(art.reference.card, variant.borders, displayedRarity)
      const visual = (visualScores.get(variant.key) ?? 1) - bestVisual
      const score = relativeArt * 0.52 + artIndex * 0.018 + rarity.penalty * 1.55 + visual * 0.95
      candidates.push({ card: art.reference.card, borders: variant.borders, score, artDistance: art.distance, exactRarity: rarity.exact })
    }
  })

  candidates.sort((left, right) => left.score - right.score)
  const best = candidates[0]
  const nextDifferent = candidates.find((candidate) => candidate.card.name !== best.card.name || borderKey(candidate.borders) !== borderKey(best.borders))
  const gap = nextDifferent ? Math.max(0, nextDifferent.score - best.score) : 0.5
  const artSecond = artworkRanking[1]?.distance ?? best.artDistance * 1.5
  const artSeparation = Math.max(0, (artSecond - best.artDistance) / Math.max(0.0001, artSecond))
  const confidence = Math.round(Math.max(18, Math.min(98, 46 + artSeparation * 90 + gap * 70 + (best.exactRarity ? 14 : 0))))
  const alternatives = [...new Set(candidates.slice(1, 20).map((candidate) => candidate.card.name).filter((name) => name !== best.card.name))].slice(0, 3)
  const method = best.exactRarity ? 'Artwork + exact rarity + game border palette' : displayedRarity ? 'Artwork + rarity + game border palette' : 'Artwork + game border palette'
  return { cardName: best.card.name, borders: canonicalBorders(best.borders), confidence, displayedRarity, method, alternatives }
}

export async function scanInventoryScreenshot(
  file: File,
  onProgress: (progress: InventoryScanProgress) => void = () => {},
): Promise<InventoryScanResult[]> {
  const image = await loadImageFile(file)
  onProgress({ stage: 'grid', current: 0, total: 1, message: 'Finding the inventory grid' })
  const cells = detectInventoryGrid(image)
  const references = await getArtworkReferences(onProgress)
  const worker = await getOcrWorker(onProgress)
  const results: InventoryScanResult[] = []

  for (let index = 0; index < cells.length; index++) {
    const cell = cells[index]
    onProgress({ stage: 'cards', current: index, total: cells.length, message: `Reading card ${index + 1}/${cells.length}` })
    const displayedRarity = await recognizeRarity(worker, image, cell)
    const match = matchCell(image, cell, references, displayedRarity)
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
