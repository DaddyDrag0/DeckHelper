import type { AppState, AuraOwnedBorder, DeckSlot, InventoryState, OwnedAura, OwnedCard, SavedDeck } from './app-types'
import cards from './data/cards'
import { isDepthsSourceEligible, MAX_DEPTH_BANS } from './engine/depths'
import type { AuraBorderName, BorderName, TeamLoadout } from './types'
import { cardVariantKey, canonicalBorders } from './card-variants'
import { depthSelectableAbilityAuraNames, depthSelectableCardNames, depthSelectableStatAuraNames } from './selectable'

const STORAGE_KEY = 'deckhelper.state.v1'
const CARD_BORDERS: BorderName[] = ['Platinum', 'Crystal', 'Ruby', 'Galaxy']
const AURA_BORDERS: AuraOwnedBorder[] = ['Base', 'Platinum', 'Crystal', 'Galaxy']
const INVENTORY_CODE_PREFIX = 'DHINV1:'
const CARD_BY_NAME = new Map(cards.map((card) => [card.name, card] as const))

const EMPTY_LOADOUT: TeamLoadout = { cards: [], statAura: null, abilityAura: null }

export function defaultState(): AppState {
  return {
    inventory: { cards: [], statAuras: [], abilityAuras: [] },
    depthBans: [],
    favorites: [],
    currentDeck: { ...EMPTY_LOADOUT, cards: [] },
  }
}

function cleanDepthBans(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const result: string[] = []
  for (const raw of value) {
    if (typeof raw !== 'string') continue
    const name = raw.trim()
    const card = CARD_BY_NAME.get(name)
    if (!name || seen.has(name) || !card || !isDepthsSourceEligible(card)) continue
    seen.add(name)
    result.push(name)
    if (result.length >= MAX_DEPTH_BANS) break
  }
  return result
}

function cleanCard(value: unknown): OwnedCard | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Partial<OwnedCard>
  if (!raw.cardName || typeof raw.cardName !== 'string' || !depthSelectableCardNames.has(raw.cardName)) return null
  const quantity = Number.isFinite(Number(raw.quantity))
    ? Math.max(1, Math.min(999, Math.floor(Number(raw.quantity))))
    : 1
  const borders = Array.isArray(raw.borders)
    ? raw.borders.filter((border): border is BorderName => CARD_BORDERS.includes(border as BorderName))
    : []
  const position = Number.isInteger(raw.lockedPosition) && Number(raw.lockedPosition) >= 0 && Number(raw.lockedPosition) <= 3
    ? Number(raw.lockedPosition) as DeckSlot
    : null
  return {
    cardName: raw.cardName,
    quantity,
    borders: canonicalBorders(borders),
    locked: Boolean(raw.locked || position !== null),
    lockedPosition: position,
  }
}

function cleanAura(value: unknown): OwnedAura | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Partial<OwnedAura>
  if (!raw.auraName || typeof raw.auraName !== 'string') return null
  const borders = Array.isArray(raw.borders)
    ? raw.borders.filter((border): border is AuraOwnedBorder => AURA_BORDERS.includes(border as AuraOwnedBorder))
    : []
  const border = [...AURA_BORDERS].reverse().find((candidate) => borders.includes(candidate)) ?? 'Base'
  return {
    auraName: raw.auraName,
    borders: [border],
    locked: Boolean(raw.locked),
  }
}

export function sanitizeInventory(value: unknown): InventoryState {
  if (!value || typeof value !== 'object') return { cards: [], statAuras: [], abilityAuras: [] }
  const raw = value as Partial<InventoryState>
  const cleanedCards = Array.isArray(raw.cards) ? raw.cards.map(cleanCard).filter((card): card is OwnedCard => Boolean(card)) : []
  const variants = new Map<string, OwnedCard>()
  for (const card of cleanedCards) {
    const key = cardVariantKey(card.cardName, card.borders)
    const existing = variants.get(key)
    if (!existing) {
      variants.set(key, { ...card, borders: canonicalBorders(card.borders) })
      continue
    }
    existing.quantity = Math.min(999, existing.quantity + card.quantity)
    existing.locked = existing.locked || card.locked
    if (existing.lockedPosition === null) existing.lockedPosition = card.lockedPosition
    else if (card.lockedPosition !== null && existing.lockedPosition !== card.lockedPosition) existing.lockedPosition = null
  }
  const statAuras = Array.isArray(raw.statAuras) ? raw.statAuras.map(cleanAura).filter((aura): aura is OwnedAura => Boolean(aura)).filter((aura) => depthSelectableStatAuraNames.has(aura.auraName)) : []
  const abilityAuras = Array.isArray(raw.abilityAuras) ? raw.abilityAuras.map(cleanAura).filter((aura): aura is OwnedAura => Boolean(aura)).filter((aura) => depthSelectableAbilityAuraNames.has(aura.auraName)) : []
  return {
    cards: [...variants.values()],
    statAuras: dedupeBy(statAuras, (aura) => aura.auraName),
    abilityAuras: dedupeBy(abilityAuras, (aura) => aura.auraName),
  }
}

function encodeBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, Math.min(bytes.length, index + 0x8000)))
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function decodeBase64Url(value: string): string {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4)
  const binary = atob(padded)
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

export function exportInventoryCode(inventory: InventoryState): string {
  const payload = { version: 1, inventory: sanitizeInventory(inventory) }
  return INVENTORY_CODE_PREFIX + encodeBase64Url(JSON.stringify(payload))
}

export function importInventoryCode(code: string): InventoryState {
  const trimmed = code.trim()
  if (!trimmed.startsWith(INVENTORY_CODE_PREFIX)) throw new Error('That is not a DeckHelper inventory code.')
  try {
    const decoded = decodeBase64Url(trimmed.slice(INVENTORY_CODE_PREFIX.length))
    const payload = JSON.parse(decoded) as { version?: unknown; inventory?: unknown }
    if (payload.version !== 1) throw new Error('Unsupported inventory code version.')
    if (!payload.inventory || typeof payload.inventory !== 'object') throw new Error('Inventory data is missing.')
    return sanitizeInventory(payload.inventory)
  } catch (error) {
    if (error instanceof Error && (error.message === 'Unsupported inventory code version.' || error.message === 'Inventory data is missing.')) throw error
    throw new Error('That inventory code is damaged or incomplete.')
  }
}

function cleanAuraSelection(value: unknown, kind: 'stat' | 'ability') {
  if (!value || typeof value !== 'object') return null
  const raw = value as { auraName?: unknown; border?: unknown }
  if (typeof raw.auraName !== 'string' || !raw.auraName) return null
  const allowedNames = kind === 'stat' ? depthSelectableStatAuraNames : depthSelectableAbilityAuraNames
  if (!allowedNames.has(raw.auraName)) return null
  const border = raw.border == null || ['Platinum', 'Crystal', 'Galaxy'].includes(String(raw.border))
    ? raw.border as AuraBorderName | null | undefined
    : null
  return { auraName: raw.auraName, border: border ?? null }
}

function cleanLoadout(value: unknown): TeamLoadout {
  if (!value || typeof value !== 'object') return { ...EMPTY_LOADOUT, cards: [] }
  const raw = value as Partial<TeamLoadout>
  const cards = Array.isArray(raw.cards)
    ? raw.cards.slice(0, 4).flatMap((slot) => {
        if (!slot || typeof slot !== 'object') return []
        const candidate = slot as { cardName?: unknown; borders?: unknown }
        if (typeof candidate.cardName !== 'string' || !candidate.cardName || !depthSelectableCardNames.has(candidate.cardName)) return []
        const borders = Array.isArray(candidate.borders)
          ? candidate.borders.filter((border): border is BorderName => CARD_BORDERS.includes(border as BorderName))
          : []
        return [{ cardName: candidate.cardName, borders: canonicalBorders(borders) }]
      })
    : []
  return {
    cards,
    statAura: cleanAuraSelection(raw.statAura, 'stat'),
    abilityAura: cleanAuraSelection(raw.abilityAura, 'ability'),
  }
}

function cleanFavorite(value: unknown): SavedDeck | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Partial<SavedDeck>
  if (typeof raw.id !== 'string' || typeof raw.name !== 'string') return null
  return {
    id: raw.id,
    name: raw.name.trim() || 'Saved Deck',
    loadout: cleanLoadout(raw.loadout),
    createdAt: Number.isFinite(raw.createdAt) ? Number(raw.createdAt) : Date.now(),
  }
}

function dedupeBy<T>(values: T[], key: (value: T) => string): T[] {
  const seen = new Set<string>()
  return values.filter((value) => {
    const id = key(value)
    if (seen.has(id)) return false
    seen.add(id)
    return true
  })
}

export function loadState(): AppState {
  try {
    const text = localStorage.getItem(STORAGE_KEY)
    if (!text) return defaultState()
    const raw = JSON.parse(text) as Partial<AppState>
    const favorites = Array.isArray(raw.favorites)
      ? raw.favorites.map(cleanFavorite).filter((favorite): favorite is SavedDeck => Boolean(favorite))
      : []
    return {
      inventory: sanitizeInventory(raw.inventory),
      depthBans: cleanDepthBans(raw.depthBans),
      favorites,
      currentDeck: cleanLoadout(raw.currentDeck),
    }
  } catch {
    return defaultState()
  }
}

export function saveState(state: AppState): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
}

export function makeFavorite(name: string, loadout: TeamLoadout): SavedDeck {
  const random = Math.random().toString(36).slice(2, 9)
  return {
    id: `${Date.now().toString(36)}-${random}`,
    name: name.trim() || 'Saved Deck',
    loadout: JSON.parse(JSON.stringify(loadout)) as TeamLoadout,
    createdAt: Date.now(),
  }
}
