import thumbnails from '../data/thumbnails.json'
import type { AuraSelection, TeamLoadout } from '../types'

const thumbnailMap = thumbnails as Record<string, string>

export function thumbnail(assetId: number | null | undefined): string {
  if (!assetId || !thumbnailMap[String(assetId)]) return ''
  return `./public/card-images/${assetId}.webp`
}

export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

export function formatNumber(value: number, digits = 0): string {
  if (!Number.isFinite(value)) return '—'
  return value.toLocaleString('en-US', { maximumFractionDigits: digits })
}

export function formatCompact(value: number): string {
  if (!Number.isFinite(value)) return '—'
  const abs = Math.abs(value)
  const units: Array<[number, string]> = [
    [1e15, 'Qd'],
    [1e12, 'T'],
    [1e9, 'B'],
    [1e6, 'M'],
    [1e3, 'K'],
  ]
  for (const [threshold, suffix] of units) {
    if (abs >= threshold) return `${(value / threshold).toFixed(abs / threshold >= 100 ? 0 : 1).replace(/\.0$/, '')}${suffix}`
  }
  return formatNumber(value)
}

export function auraLabel(aura?: AuraSelection | null): string {
  if (!aura) return 'None'
  return `${aura.auraName}${aura.border ? ` · ${aura.border}` : ' · Base'}`
}

export function deckLabel(loadout: TeamLoadout): string {
  return loadout.cards.map((card) => card.cardName).join(' / ')
}

export function borderLabel(borders: string[]): string {
  return borders.length ? borders.join(' + ') : 'Base'
}