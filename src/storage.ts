import type { AppState, AuraOwnedBorder, DeckSlot, InventoryState, OwnedAura, OwnedCard, SavedDeck } from './app-types'
import type { AuraBorderName, BorderName, TeamLoadout } from './types'

const STORAGE_KEY = 'deckhelper.state.v1'
const CARD_BORDERS: BorderName[] = ['Platinum', 'Crystal', 'Ruby', 'Galaxy']
const AURA_BORDERS: AuraOwnedBorder[] = ['Base', 'Platinum', 'Crystal', 'Galaxy']

const EMPTY_LOADOUT: TeamLoadout = { cards: [], statAura: null, abilityAura: null }

export function defaultState(): AppState {
  return {
    inventory: { cards: [], statAuras: [], abilityAuras: [] },
    favorites: [],
    currentDeck: { ...EMPTY_LOADOUT, cards: [] },
  }
}

function cleanCard(value: unknown): OwnedCard | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Partial<OwnedCard>
  if (!raw.cardName || typeof raw.cardName !== 'string') return null
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
    borders: [...new Set(borders)],
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
  return {
    auraName: raw.auraName,
    borders: [...new Set(borders.length ? borders : ['Base' as AuraOwnedBorder])],
    locked: Boolean(raw.locked),
  }
}

function cleanInventory(value: unknown): InventoryState {
  if (!value || typeof value !== 'object') return { cards: [], statAuras: [], abilityAuras: [] }
  const raw = value as Partial<InventoryState>
  const cards = Array.isArray(raw.cards) ? raw.cards.map(cleanCard).filter((card): card is OwnedCard => Boolean(card)) : []
  const statAuras = Array.isArray(raw.statAuras) ? raw.statAuras.map(cleanAura).filter((aura): aura is OwnedAura => Boolean(aura)) : []
  const abilityAuras = Array.isArray(raw.abilityAuras) ? raw.abilityAuras.map(cleanAura).filter((aura): aura is OwnedAura => Boolean(aura)) : []
  return {
    cards: dedupeBy(cards, (card) => card.cardName),
    statAuras: dedupeBy(statAuras, (aura) => aura.auraName),
    abilityAuras: dedupeBy(abilityAuras, (aura) => aura.auraName),
  }
}

function cleanAuraSelection(value: unknown) {
  if (!value || typeof value !== 'object') return null
  const raw = value as { auraName?: unknown; border?: unknown }
  if (typeof raw.auraName !== 'string' || !raw.auraName) return null
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
        if (typeof candidate.cardName !== 'string' || !candidate.cardName) return []
        const borders = Array.isArray(candidate.borders)
          ? candidate.borders.filter((border): border is BorderName => CARD_BORDERS.includes(border as BorderName))
          : []
        return [{ cardName: candidate.cardName, borders: [...new Set(borders)] }]
      })
    : []
  return {
    cards,
    statAura: cleanAuraSelection(raw.statAura),
    abilityAura: cleanAuraSelection(raw.abilityAura),
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
      inventory: cleanInventory(raw.inventory),
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
