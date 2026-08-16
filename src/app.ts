import cards from './data/cards'
import auras from './data/auras'
import type {
  AppState,
  AuraOwnedBorder,
  DeckSlot,
  OptimizerProgress,
  OwnedAura,
  OwnedCard,
  RankedTeam,
  ReplacementResult,
  TeamMetrics,
  WorkerOutbound,
} from './app-types'
import type { AuraSelection, BorderName, TeamCard, TeamLoadout } from './types'
import { loadState, makeFavorite, saveState } from './storage'
import { auraLabel, borderLabel, deckLabel, escapeHtml, formatCompact, formatNumber, thumbnail } from './ui/format'
import { ALL_CARD_BORDER_VARIANTS, borderKey, bordersFromKey, cardVariantKey, canonicalBorders, firstUnusedBorderVariant, teamCardVariantKey } from './card-variants'
import { scanInventoryScreenshot, type InventoryScanResult } from './importer'

const CARD_BORDERS: BorderName[] = ['Platinum', 'Crystal', 'Ruby', 'Galaxy']
const AURA_BORDERS: AuraOwnedBorder[] = ['Base', 'Platinum', 'Crystal', 'Galaxy']

type Tab = 'inventory' | 'optimize' | 'decks'
type Ranking = 'average' | 'median' | 'minimum' | 'maximum' | 'consistency'

export class DeckHelperApp {
  private state: AppState = loadState()
  private tab: Tab = 'inventory'
  private ranking: Ranking = 'average'
  private cardSearch = ''
  private ownedOnly = false
  private auraSearch = ''
  private worker: Worker | null = null
  private progress: OptimizerProgress | null = null
  private results: RankedTeam[] = []
  private replacementResults: ReplacementResult[] = []
  private replacementBaseline: TeamMetrics | null = null
  private replacementSlot: DeckSlot | null = null
  private error = ''
  private scanOpen = false
  private scanBusy = false
  private scanProgressText = ''
  private scanResults: InventoryScanResult[] = []
  private scanError = ''

  constructor(private root: HTMLElement) {
    this.syncCurrentDeck()
    this.root.addEventListener('click', (event) => this.onClick(event))
    this.root.addEventListener('change', (event) => this.onChange(event))
    this.root.addEventListener('input', (event) => this.onInput(event))
  }

  start() {
    this.render()
  }

  private persist() {
    this.syncCurrentDeck()
    saveState(this.state)
  }

  private syncCurrentDeck() {
    const owned = new Map(this.state.inventory.cards.map((card) => [cardVariantKey(card.cardName, card.borders), card] as const))
    const used = new Map<string, number>()
    this.state.currentDeck.cards = this.state.currentDeck.cards.slice(0, 4).flatMap((slot) => {
      const key = teamCardVariantKey(slot)
      const card = owned.get(key)
      const count = used.get(key) ?? 0
      if (!card || count >= card.quantity) return []
      used.set(key, count + 1)
      return [{ cardName: card.cardName, borders: canonicalBorders(card.borders) }]
    })
    if (!this.auraSelectionOwned(this.state.currentDeck.statAura, this.state.inventory.statAuras)) this.state.currentDeck.statAura = null
    if (!this.auraSelectionOwned(this.state.currentDeck.abilityAura, this.state.inventory.abilityAuras)) this.state.currentDeck.abilityAura = null
  }

  private auraSelectionOwned(selection: AuraSelection | null | undefined, owned: OwnedAura[]): boolean {
    if (!selection) return true
    const aura = owned.find((entry) => entry.auraName === selection.auraName)
    if (!aura) return false
    const border = selection.border ?? 'Base'
    return aura.borders.includes(border)
  }

  private render() {
    this.syncCurrentDeck()
    this.root.innerHTML = `
      <div class="app-shell">
        <header class="topbar">
          <div>
            <div class="eyebrow">Card Fantasy RNG</div>
            <h1>DeckHelper</h1>
          </div>
          <div class="top-stats">
            <span><b>${this.state.inventory.cards.reduce((sum, card) => sum + card.quantity, 0)}</b> cards</span>
            <span><b>${this.state.inventory.statAuras.length + this.state.inventory.abilityAuras.length}</b> auras</span>
            <span><b>${this.state.favorites.length}</b> saved decks</span>
          </div>
        </header>
        <nav class="tabs">
          ${this.tabButton('inventory', 'Inventory')}
          ${this.tabButton('optimize', 'Optimize')}
          ${this.tabButton('decks', 'Decks')}
        </nav>
        ${this.error ? `<div class="error-banner">${escapeHtml(this.error)}<button data-action="clear-error">×</button></div>` : ''}
        <main>${this.tab === 'inventory' ? this.renderInventory() : this.tab === 'optimize' ? this.renderOptimize() : this.renderDecks()}</main>
        ${this.scanOpen ? this.renderScanModal() : ''}
      </div>
    `
  }

  private tabButton(tab: Tab, label: string) {
    return `<button class="tab ${this.tab === tab ? 'active' : ''}" data-action="tab" data-tab="${tab}">${label}</button>`
  }

  private renderInventory() {
    const query = this.cardSearch.trim().toLowerCase()
    const ownedByName = new Map<string, OwnedCard[]>()
    for (const owned of this.state.inventory.cards) {
      const list = ownedByName.get(owned.cardName) ?? []
      list.push(owned)
      ownedByName.set(owned.cardName, list)
    }
    const filteredCards = cards.filter((card) => {
      if (this.ownedOnly && !ownedByName.has(card.name)) return false
      return !query || card.name.toLowerCase().includes(query) || (card.ability || '').toLowerCase().includes(query)
    })
    const auraQuery = this.auraSearch.trim().toLowerCase()
    const filteredAuras = auras.filter((aura) => !auraQuery || aura.name.toLowerCase().includes(auraQuery) || (aura.skillName || '').toLowerCase().includes(auraQuery))

    return `
      <section class="page-head split">
        <div><h2>Inventory</h2><p>Each exact border combination is stored separately, so the same card can have multiple owned variants.</p></div>
        <div class="actions">
          <button class="primary" data-action="open-import">Import Screenshot</button>
          <input id="inventory-import-file" type="file" accept="image/png,image/jpeg,image/webp" hidden>
        </div>
      </section>
      <section class="panel inventory-panel">
        <div class="toolbar">
          <label class="search"><span>Search cards</span><input id="card-search" value="${escapeHtml(this.cardSearch)}" placeholder="Card name or ability"></label>
          <label class="check-line"><input type="checkbox" id="owned-only" ${this.ownedOnly ? 'checked' : ''}> Owned only</label>
          <span class="muted">${filteredCards.length} shown · ${this.state.inventory.cards.length} exact variants</span>
        </div>
        <div class="card-list">
          ${filteredCards.map((card) => this.renderInventoryCard(card, ownedByName.get(card.name) ?? [])).join('')}
        </div>
      </section>
      <section class="panel aura-inventory">
        <div class="toolbar">
          <label class="search"><span>Search auras</span><input id="aura-search" value="${escapeHtml(this.auraSearch)}" placeholder="Aura name or skill"></label>
          <span class="muted">Aura borders do not stack; check every variant you own.</span>
        </div>
        <div class="aura-columns">
          <div><h3>Stat Auras</h3>${filteredAuras.filter((aura) => aura.type === 'Stat').map((aura) => this.renderInventoryAura(aura.name, 'stat')).join('')}</div>
          <div><h3>Ability Auras</h3>${filteredAuras.filter((aura) => aura.type === 'Skill').map((aura) => this.renderInventoryAura(aura.name, 'ability')).join('')}</div>
        </div>
      </section>
    `
  }

  private renderInventoryCard(card: (typeof cards)[number], ownedVariants: OwnedCard[]) {
    const image = thumbnail(card.imageAssetId)
    const variants = [...ownedVariants].sort((left, right) => borderKey(left.borders).localeCompare(borderKey(right.borders)))
    return `
      <section class="inventory-card-group ${variants.length ? 'owned' : ''}">
        <article class="inventory-row inventory-card-head">
          <div class="thumb">${image ? `<img src="${escapeHtml(image)}" alt="">` : '<span>?</span>'}</div>
          <div class="item-main">
            <strong>${escapeHtml(card.name)}</strong>
            <small>${escapeHtml(card.ability || 'No ability')} · Base 1/${formatCompact(card.rarity)}</small>
          </div>
          <span class="variant-count">${variants.length ? `${variants.length} variant${variants.length === 1 ? '' : 's'}` : 'Not owned'}</span>
          <button class="primary compact" data-action="add-card" data-name="${escapeHtml(card.name)}">${variants.length ? '+ Variant' : 'Add'}</button>
        </article>
        ${variants.map((owned) => {
          const encodedKey = encodeURIComponent(cardVariantKey(owned.cardName, owned.borders))
          return `
            <div class="inventory-variant-row">
              <div class="variant-title"><strong>${escapeHtml(borderLabel(owned.borders))}</strong><small>Exact owned copy type</small></div>
              <div class="border-picker">
                ${CARD_BORDERS.map((border) => `<label><input type="checkbox" data-action="card-border" data-key="${escapeHtml(encodedKey)}" data-border="${border}" ${owned.borders.includes(border) ? 'checked' : ''}><span>${border}</span></label>`).join('')}
              </div>
              <label class="quantity-field"><span>Qty</span><input type="number" min="1" max="999" step="1" value="${owned.quantity}" data-action="card-quantity" data-key="${escapeHtml(encodedKey)}"></label>
              <label class="lock-check"><input type="checkbox" data-action="card-lock" data-key="${escapeHtml(encodedKey)}" ${owned.locked ? 'checked' : ''}> Lock</label>
              <select class="position-select" data-action="card-position" data-key="${escapeHtml(encodedKey)}">
                <option value="">Any position</option>
                ${[0, 1, 2, 3].map((position) => `<option value="${position}" ${owned.lockedPosition === position ? 'selected' : ''}>Position ${position + 1}</option>`).join('')}
              </select>
              <button class="danger subtle" data-action="remove-card" data-key="${escapeHtml(encodedKey)}">Remove</button>
            </div>
          `
        }).join('')}
      </section>
    `
  }

  private renderInventoryAura(name: string, type: 'stat' | 'ability') {
    const definition = auras.find((aura) => aura.name === name)!
    const ownedList = type === 'stat' ? this.state.inventory.statAuras : this.state.inventory.abilityAuras
    const owned = ownedList.find((aura) => aura.auraName === name)
    const image = thumbnail(definition.imageAssetId)
    return `
      <article class="aura-row ${owned ? 'owned' : ''}">
        <div class="thumb small">${image ? `<img src="${escapeHtml(image)}" alt="">` : '<span>?</span>'}</div>
        <div class="item-main"><strong>${escapeHtml(name)}</strong><small>${escapeHtml(definition.skillName || definition.type || '')}</small></div>
        ${owned ? `
          <div class="aura-borders">
            ${AURA_BORDERS.map((border) => `<label><input type="checkbox" data-action="aura-border" data-kind="${type}" data-name="${escapeHtml(name)}" data-border="${border}" ${owned.borders.includes(border) ? 'checked' : ''}><span>${border}</span></label>`).join('')}
          </div>
          <label class="lock-check"><input type="checkbox" data-action="aura-lock" data-kind="${type}" data-name="${escapeHtml(name)}" ${owned.locked ? 'checked' : ''}> Lock</label>
          <button class="danger subtle" data-action="remove-aura" data-kind="${type}" data-name="${escapeHtml(name)}">Remove</button>
        ` : `<button class="primary compact" data-action="add-aura" data-kind="${type}" data-name="${escapeHtml(name)}">Add</button>`}
      </article>
    `
  }

  private renderOptimize() {
    const lockedCards = this.state.inventory.cards.filter((card) => card.locked || card.lockedPosition !== null)
    const lockedStat = this.state.inventory.statAuras.find((aura) => aura.locked)
    const lockedAbility = this.state.inventory.abilityAuras.find((aura) => aura.locked)
    const sorted = this.sortedResults()
    return `
      <section class="page-head split">
        <div><h2>Optimizer</h2><p>Adaptive battle-simulator search. Weak candidates are discarded early; expensive testing is reserved for stronger teams.</p></div>
        <div class="actions">
          ${this.worker ? `<button class="danger" data-action="cancel-search">Cancel Search</button>` : `<button class="primary" data-action="start-search" ${this.state.inventory.cards.reduce((sum, card) => sum + card.quantity, 0) < 4 ? 'disabled' : ''}>Find Best 4-Card Teams</button>`}
        </div>
      </section>
      <section class="lock-summary panel">
        <div><span>Locked cards</span><strong>${lockedCards.length ? lockedCards.map((card) => `${escapeHtml(card.cardName)} · ${escapeHtml(borderLabel(card.borders))}${card.lockedPosition !== null ? ` (#${card.lockedPosition + 1})` : ''}`).join(', ') : 'None'}</strong></div>
        <div><span>Stat Aura</span><strong>${lockedStat ? escapeHtml(lockedStat.auraName) : 'Auto'}</strong></div>
        <div><span>Ability Aura</span><strong>${lockedAbility ? escapeHtml(lockedAbility.auraName) : 'Auto'}</strong></div>
      </section>
      ${this.progress ? this.renderProgress(this.progress) : ''}
      ${this.results.length ? `
        <section class="results-head">
          <h3>Top Teams</h3>
          <div class="ranking-tabs">
            ${this.rankingButton('average', 'Average')}${this.rankingButton('median', 'Median')}${this.rankingButton('minimum', 'Safest')}${this.rankingButton('maximum', 'Ceiling')}${this.rankingButton('consistency', 'Consistent')}
          </div>
        </section>
        <section class="result-list">${sorted.map((result, index) => this.renderResult(result, index + 1)).join('')}</section>
      ` : `<section class="empty-state panel"><strong>No optimizer results yet.</strong><span>Add at least four owned cards, set any locks you want, then start the search.</span></section>`}
    `
  }

  private rankingButton(value: Ranking, label: string) {
    return `<button class="rank-tab ${this.ranking === value ? 'active' : ''}" data-action="ranking" data-ranking="${value}">${label}</button>`
  }

  private renderProgress(progress: OptimizerProgress) {
    const phaseLabel: Record<OptimizerProgress['phase'], string> = {
      prepare: 'Preparing candidates', quick: 'Quick testing', middle: 'Refining candidates', order: 'Optimizing order + auras', final: 'Final simulations', replacement: 'Testing replacements',
    }
    return `
      <section class="progress-card panel">
        <div class="progress-title"><strong>${phaseLabel[progress.phase]}</strong><span>${escapeHtml(progress.message || '')}</span></div>
        <div class="progress-grid">
          <div><span>Possible combinations</span><b>${formatNumber(progress.possibleCombinations)}</b></div>
          <div><span>Quick tested</span><b>${formatNumber(progress.quickTested)}</b></div>
          <div><span>Remaining</span><b>${formatNumber(progress.remainingCandidates)}</b></div>
          <div><span>Finalists</span><b>${formatNumber(progress.finalists)}</b></div>
          <div><span>Fully simulated</span><b>${formatNumber(progress.fullySimulated)} / ${formatNumber(progress.fullySimulatedTotal)}</b></div>
          <div><span>Battle simulations</span><b>${formatNumber(progress.simulations)}</b></div>
        </div>
        ${progress.currentBest ? `<div class="current-best"><span>Current best</span><strong>${escapeHtml(deckLabel(progress.currentBest.loadout))}</strong><b>Median ~ ${formatNumber(progress.currentBest.metrics.medianDepth)}</b></div>` : ''}
      </section>
    `
  }

  private sortedResults() {
    const results = [...this.results]
    const metric = (result: RankedTeam) => {
      if (this.ranking === 'average') return result.metrics.averageDepth
      if (this.ranking === 'median') return result.metrics.medianDepth
      if (this.ranking === 'minimum') return result.metrics.minimumDepth
      if (this.ranking === 'maximum') return result.metrics.maximumDepth
      return result.metrics.consistency
    }
    return results.sort((a, b) => this.ranking === 'consistency' ? metric(a) - metric(b) : metric(b) - metric(a))
  }

  private renderResult(result: RankedTeam, rank: number) {
    return `
      <article class="result-card">
        <div class="result-rank">#${rank}</div>
        <div class="result-content">
          <div class="team-slots">${result.loadout.cards.map((card, index) => `<div class="team-slot"><span>${index + 1}</span><strong>${escapeHtml(card.cardName)}</strong><small>${escapeHtml(borderLabel(card.borders))}</small></div>`).join('')}</div>
          <div class="aura-line"><span>Stat: <b>${escapeHtml(auraLabel(result.loadout.statAura))}</b></span><span>Ability: <b>${escapeHtml(auraLabel(result.loadout.abilityAura))}</b></span></div>
          <div class="metrics">
            <div><span>Average</span><b>${formatNumber(result.metrics.averageDepth)}</b></div>
            <div><span>Median</span><b>${formatNumber(result.metrics.medianDepth)}</b></div>
            <div><span>Minimum</span><b>${formatNumber(result.metrics.minimumDepth)}</b></div>
            <div><span>Maximum</span><b>${formatNumber(result.metrics.maximumDepth)}</b></div>
            <div><span>Spread</span><b>${formatNumber(result.metrics.consistency)}</b></div>
          </div>
          ${result.metrics.trusted ? '' : `<div class="warning">Unverified mechanics: ${escapeHtml(result.metrics.unsupportedAbilities.join(', '))}</div>`}
        </div>
        <div class="result-actions"><button data-action="use-result" data-result="${escapeHtml(result.id)}">Use Deck</button><button data-action="save-result" data-result="${escapeHtml(result.id)}">Save</button></div>
      </article>
    `
  }

  private renderDecks() {
    const deck = this.state.currentDeck
    const complete = deck.cards.length === 4
    return `
      <section class="page-head"><div><h2>Current Deck & Favorites</h2><p>Build a deck manually, save it, or test the best owned replacement for any slot.</p></div></section>
      <section class="panel current-deck">
        <div class="deck-editor">
          ${[0, 1, 2, 3].map((slot) => this.renderDeckSlot(slot as DeckSlot)).join('')}
        </div>
        <div class="deck-aura-row">
          <label><span>Stat Aura</span>${this.renderAuraSelect('stat', deck.statAura)}</label>
          <label><span>Ability Aura</span>${this.renderAuraSelect('ability', deck.abilityAura)}</label>
        </div>
        <div class="save-row">
          <input id="favorite-name" placeholder="Deck name">
          <button class="primary" data-action="save-current" ${complete ? '' : 'disabled'}>Save Favorite</button>
        </div>
      </section>
      ${this.progress?.phase === 'replacement' ? this.renderProgress(this.progress) : ''}
      ${this.replacementResults.length ? this.renderReplacementResults() : ''}
      <section class="favorites-section">
        <h3>Favorites</h3>
        ${this.state.favorites.length ? `<div class="favorite-list">${this.state.favorites.map((favorite) => `
          <article class="favorite-card">
            <div><strong>${escapeHtml(favorite.name)}</strong><span>${escapeHtml(deckLabel(favorite.loadout))}</span><small>${escapeHtml(auraLabel(favorite.loadout.statAura))} · ${escapeHtml(auraLabel(favorite.loadout.abilityAura))}</small></div>
            <div><button data-action="load-favorite" data-id="${escapeHtml(favorite.id)}">Load</button><button class="danger subtle" data-action="delete-favorite" data-id="${escapeHtml(favorite.id)}">Delete</button></div>
          </article>`).join('')}</div>` : `<div class="empty-state panel"><span>No saved decks yet.</span></div>`}
      </section>
    `
  }

  private renderDeckSlot(slot: DeckSlot) {
    const current = this.state.currentDeck.cards[slot]
    const currentKey = current ? teamCardVariantKey(current) : ''
    const usedElsewhere = new Map<string, number>()
    this.state.currentDeck.cards.forEach((card, index) => {
      if (index === slot) return
      const key = teamCardVariantKey(card)
      usedElsewhere.set(key, (usedElsewhere.get(key) ?? 0) + 1)
    })
    const options = this.state.inventory.cards.filter((card) => {
      const key = cardVariantKey(card.cardName, card.borders)
      return (usedElsewhere.get(key) ?? 0) < card.quantity || key === currentKey
    })
    const owned = current ? this.state.inventory.cards.find((card) => cardVariantKey(card.cardName, card.borders) === currentKey) : undefined
    return `
      <div class="deck-slot-editor">
        <span class="slot-number">${slot + 1}</span>
        <select data-action="deck-card" data-slot="${slot}">
          <option value="">Select card variant</option>
          ${options.map((card) => {
            const key = cardVariantKey(card.cardName, card.borders)
            return `<option value="${escapeHtml(encodeURIComponent(key))}" ${currentKey === key ? 'selected' : ''}>${escapeHtml(card.cardName)} · ${escapeHtml(borderLabel(card.borders))}${card.quantity > 1 ? ` ×${card.quantity}` : ''}</option>`
          }).join('')}
        </select>
        <small>${owned ? `${escapeHtml(borderLabel(owned.borders))} · ${owned.quantity} owned` : '—'}</small>
        <button data-action="replacement" data-slot="${slot}" ${this.state.currentDeck.cards.length === 4 && !this.worker ? '' : 'disabled'}>Best replacement</button>
      </div>
    `
  }

  private renderAuraSelect(kind: 'stat' | 'ability', current?: AuraSelection | null) {
    const source = kind === 'stat' ? this.state.inventory.statAuras : this.state.inventory.abilityAuras
    const options = source.flatMap((aura) => aura.borders.map((border) => ({ auraName: aura.auraName, border: border === 'Base' ? null : border })))
    const currentValue = current ? this.encodeAura(current) : ''
    return `<select data-action="deck-aura" data-kind="${kind}"><option value="">None</option>${options.map((option) => {
      const value = this.encodeAura(option)
      return `<option value="${escapeHtml(value)}" ${value === currentValue ? 'selected' : ''}>${escapeHtml(auraLabel(option))}</option>`
    }).join('')}</select>`
  }

  private renderReplacementResults() {
    return `
      <section class="replacement-section">
        <div class="results-head"><h3>Replacement Results${this.replacementSlot !== null ? ` · Slot ${this.replacementSlot + 1}` : ''}</h3>${this.replacementBaseline ? `<span>Current median: ${formatNumber(this.replacementBaseline.medianDepth)}</span>` : ''}</div>
        <div class="replacement-list">${this.replacementResults.map((result, index) => `
          <article class="replacement-card">
            <b>#${index + 1}</b>
            <div><strong>${escapeHtml(result.cardName)} · ${escapeHtml(borderLabel(result.borders))}</strong><span>${escapeHtml(deckLabel(result.loadout))}</span></div>
            <div><span>Median ${formatNumber(result.metrics.medianDepth)}</span><strong class="${result.medianDelta >= 0 ? 'positive' : 'negative'}">${result.medianDelta >= 0 ? '+' : ''}${formatNumber(result.medianDelta)}</strong></div>
            <button data-action="use-replacement" data-index="${index}">Use</button>
          </article>`).join('')}</div>
      </section>
    `
  }

  private encodeAura(selection: AuraSelection) {
    return encodeURIComponent(JSON.stringify({ auraName: selection.auraName, border: selection.border ?? null }))
  }

  private decodeAura(value: string): AuraSelection | null {
    if (!value) return null
    try {
      const parsed = JSON.parse(decodeURIComponent(value)) as AuraSelection
      return parsed?.auraName ? { auraName: parsed.auraName, border: parsed.border ?? null } : null
    } catch {
      return null
    }
  }

  private onInput(event: Event) {
    const target = event.target
    if (!(target instanceof HTMLInputElement)) return
    if (target.id === 'card-search') {
      this.cardSearch = target.value
      this.renderAndRefocus('card-search')
    } else if (target.id === 'aura-search') {
      this.auraSearch = target.value
      this.renderAndRefocus('aura-search')
    }
  }

  private onChange(event: Event) {
    const target = event.target
    if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) return
    const action = target.dataset.action
    if (target.id === 'inventory-import-file' && target instanceof HTMLInputElement) {
      const file = target.files?.[0]
      target.value = ''
      if (file) void this.startInventoryScan(file)
      return
    }
    if (target.id === 'owned-only' && target instanceof HTMLInputElement) {
      this.ownedOnly = target.checked
      this.render()
      return
    }
    if (action === 'card-border' && target instanceof HTMLInputElement) this.toggleCardBorder(target.dataset.key || '', target.dataset.border as BorderName, target.checked)
    if (action === 'card-quantity' && target instanceof HTMLInputElement) this.setCardQuantity(target.dataset.key || '', target.value)
    if (action === 'card-lock' && target instanceof HTMLInputElement) this.toggleCardLock(target.dataset.key || '', target.checked)
    if (action === 'card-position' && target instanceof HTMLSelectElement) this.setCardPosition(target.dataset.key || '', target.value)
    if (action === 'scan-card' && target instanceof HTMLSelectElement) { const result = this.scanResults[Number(target.dataset.index)]; if (result) result.cardName = target.value }
    if (action === 'scan-border' && target instanceof HTMLSelectElement) { const result = this.scanResults[Number(target.dataset.index)]; if (result) result.borders = bordersFromKey(target.value) }
    if (action === 'scan-quantity' && target instanceof HTMLInputElement) { const result = this.scanResults[Number(target.dataset.index)]; if (result) result.quantity = Math.max(1, Math.min(999, Math.floor(Number(target.value) || 1))) }
    if (action === 'aura-border' && target instanceof HTMLInputElement) this.toggleAuraBorder(target.dataset.kind as 'stat' | 'ability', target.dataset.name || '', target.dataset.border as AuraOwnedBorder, target.checked)
    if (action === 'aura-lock' && target instanceof HTMLInputElement) this.toggleAuraLock(target.dataset.kind as 'stat' | 'ability', target.dataset.name || '', target.checked)
    if (action === 'deck-card' && target instanceof HTMLSelectElement) this.setDeckCard(Number(target.dataset.slot) as DeckSlot, target.value)
    if (action === 'deck-aura' && target instanceof HTMLSelectElement) this.setDeckAura(target.dataset.kind as 'stat' | 'ability', this.decodeAura(target.value))
  }

  private onClick(event: Event) {
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-action]') : null
    if (!target) return
    const action = target.dataset.action
    if (action === 'tab') {
      this.tab = target.dataset.tab as Tab
      this.render()
    } else if (action === 'clear-error') {
      this.error = ''
      this.render()
    } else if (action === 'open-import') (document.getElementById('inventory-import-file') as HTMLInputElement | null)?.click()
    else if (action === 'scan-close') { if (!this.scanBusy) { this.scanOpen = false; this.render() } }
    else if (action === 'scan-add') this.applyScanResults(false)
    else if (action === 'scan-replace') this.applyScanResults(true)
    else if (action === 'add-card') this.addCard(target.dataset.name || '')
    else if (action === 'remove-card') this.removeCard(target.dataset.key || '')
    else if (action === 'add-aura') this.addAura(target.dataset.kind as 'stat' | 'ability', target.dataset.name || '')
    else if (action === 'remove-aura') this.removeAura(target.dataset.kind as 'stat' | 'ability', target.dataset.name || '')
    else if (action === 'start-search') this.startSearch()
    else if (action === 'cancel-search') this.cancelWorker()
    else if (action === 'ranking') {
      this.ranking = target.dataset.ranking as Ranking
      this.render()
    } else if (action === 'use-result') this.useResult(target.dataset.result || '')
    else if (action === 'save-result') this.saveResult(target.dataset.result || '')
    else if (action === 'save-current') this.saveCurrent()
    else if (action === 'load-favorite') this.loadFavorite(target.dataset.id || '')
    else if (action === 'delete-favorite') this.deleteFavorite(target.dataset.id || '')
    else if (action === 'replacement') this.startReplacement(Number(target.dataset.slot) as DeckSlot)
    else if (action === 'use-replacement') this.useReplacement(Number(target.dataset.index))
  }

  private renderAndRefocus(id: string) {
    const valueLength = (document.getElementById(id) as HTMLInputElement | null)?.value.length ?? 0
    this.render()
    const input = document.getElementById(id) as HTMLInputElement | null
    if (input) {
      input.focus()
      input.setSelectionRange(valueLength, valueLength)
    }
  }

  private decodeCardKey(value: string) {
    try { return decodeURIComponent(value) } catch { return value }
  }

  private findOwnedCard(encodedKey: string) {
    const key = this.decodeCardKey(encodedKey)
    return this.state.inventory.cards.find((entry) => cardVariantKey(entry.cardName, entry.borders) === key)
  }

  private addCard(name: string) {
    if (!name) return
    const variants = this.state.inventory.cards.filter((card) => card.cardName === name)
    const borders = firstUnusedBorderVariant(variants.map((card) => card.borders))
    if (!borders) {
      this.error = `${name} already has all 16 border combinations in the inventory.`
      this.render()
      return
    }
    this.state.inventory.cards.push({ cardName: name, quantity: 1, borders: canonicalBorders(borders), locked: false, lockedPosition: null })
    this.persist(); this.render()
  }

  private removeCard(encodedKey: string) {
    const key = this.decodeCardKey(encodedKey)
    this.state.inventory.cards = this.state.inventory.cards.filter((card) => cardVariantKey(card.cardName, card.borders) !== key)
    this.state.currentDeck.cards = this.state.currentDeck.cards.filter((card) => teamCardVariantKey(card) !== key)
    this.persist(); this.render()
  }

  private toggleCardBorder(encodedKey: string, border: BorderName, checked: boolean) {
    const card = this.findOwnedCard(encodedKey)
    if (!card || !CARD_BORDERS.includes(border)) return
    const oldKey = cardVariantKey(card.cardName, card.borders)
    const nextBorders = canonicalBorders(checked ? [...card.borders, border] : card.borders.filter((value) => value !== border))
    const nextKey = cardVariantKey(card.cardName, nextBorders)
    const duplicate = this.state.inventory.cards.find((entry) => entry !== card && cardVariantKey(entry.cardName, entry.borders) === nextKey)
    if (duplicate) {
      if (duplicate.lockedPosition !== null && card.lockedPosition !== null && duplicate.lockedPosition !== card.lockedPosition) {
        this.error = 'Those two variants have different locked positions. Clear one position lock before merging them.'
        this.render()
        return
      }
      duplicate.quantity = Math.min(999, duplicate.quantity + card.quantity)
      duplicate.locked = duplicate.locked || card.locked
      duplicate.lockedPosition = duplicate.lockedPosition ?? card.lockedPosition
      this.state.inventory.cards = this.state.inventory.cards.filter((entry) => entry !== card)
    } else {
      card.borders = nextBorders
    }
    this.state.currentDeck.cards = this.state.currentDeck.cards.map((slot) => teamCardVariantKey(slot) === oldKey
      ? { cardName: card.cardName, borders: canonicalBorders(nextBorders) }
      : slot)
    this.persist(); this.render()
  }

  private setCardQuantity(encodedKey: string, value: string) {
    const card = this.findOwnedCard(encodedKey)
    if (!card) return
    const parsed = Number(value)
    card.quantity = Number.isFinite(parsed) ? Math.max(1, Math.min(999, Math.floor(parsed))) : 1
    this.persist(); this.render()
  }

  private toggleCardLock(encodedKey: string, checked: boolean) {
    const card = this.findOwnedCard(encodedKey)
    if (!card) return
    card.locked = checked
    if (!checked) card.lockedPosition = null
    this.persist(); this.render()
  }

  private setCardPosition(encodedKey: string, value: string) {
    const card = this.findOwnedCard(encodedKey)
    if (!card) return
    card.lockedPosition = value === '' ? null : Number(value) as DeckSlot
    if (card.lockedPosition !== null) card.locked = true
    this.persist(); this.render()
  }

  private auraList(kind: 'stat' | 'ability') {
    return kind === 'stat' ? this.state.inventory.statAuras : this.state.inventory.abilityAuras
  }

  private addAura(kind: 'stat' | 'ability', name: string) {
    const list = this.auraList(kind)
    if (!name || list.some((aura) => aura.auraName === name)) return
    list.push({ auraName: name, borders: ['Base'], locked: false })
    this.persist(); this.render()
  }

  private removeAura(kind: 'stat' | 'ability', name: string) {
    if (kind === 'stat') this.state.inventory.statAuras = this.state.inventory.statAuras.filter((aura) => aura.auraName !== name)
    else this.state.inventory.abilityAuras = this.state.inventory.abilityAuras.filter((aura) => aura.auraName !== name)
    this.persist(); this.render()
  }

  private toggleAuraBorder(kind: 'stat' | 'ability', name: string, border: AuraOwnedBorder, checked: boolean) {
    const aura = this.auraList(kind).find((entry) => entry.auraName === name)
    if (!aura || !AURA_BORDERS.includes(border)) return
    aura.borders = checked ? [...new Set([...aura.borders, border])] : aura.borders.filter((value) => value !== border)
    if (!aura.borders.length) aura.borders = ['Base']
    this.persist(); this.render()
  }

  private toggleAuraLock(kind: 'stat' | 'ability', name: string, checked: boolean) {
    const list = this.auraList(kind)
    for (const aura of list) aura.locked = aura.auraName === name ? checked : checked ? false : aura.locked
    this.persist(); this.render()
  }

  private setDeckCard(slot: DeckSlot, encodedKey: string) {
    const next = [...this.state.currentDeck.cards]
    if (!encodedKey) next.splice(slot, 1)
    else {
      const key = this.decodeCardKey(encodedKey)
      const owned = this.state.inventory.cards.find((card) => cardVariantKey(card.cardName, card.borders) === key)
      if (!owned) return
      const usedElsewhere = next.filter((_, index) => index !== slot).filter((card) => teamCardVariantKey(card) === key).length
      if (usedElsewhere >= owned.quantity) return
      const card: TeamCard = { cardName: owned.cardName, borders: canonicalBorders(owned.borders) }
      if (slot < next.length) next[slot] = card
      else {
        while (next.length < slot) next.push({ cardName: '', borders: [] })
        next.push(card)
      }
    }
    this.state.currentDeck.cards = next.filter((card) => card.cardName).slice(0, 4)
    this.persist(); this.render()
  }

  private renderScanModal() {
    const cardOptions = cards.filter((card) => card.rarity > 0).map((card) => card.name)
    return `
      <div class="scan-backdrop">
        <section class="scan-modal panel" role="dialog" aria-modal="true">
          <header class="scan-head">
            <div><div class="eyebrow">Expansion Screenshot Import</div><h2>Review detected variants</h2><p>Card art, displayed rarity and the game's real border gradients are combined. Same-name variants stay separate.</p></div>
            <button data-action="scan-close" ${this.scanBusy ? 'disabled' : ''}>×</button>
          </header>
          ${this.scanBusy ? `<div class="scan-loading"><span class="spinner"></span><strong data-scan-progress>${escapeHtml(this.scanProgressText || 'Reading screenshot…')}</strong><small>The first scan may take longer while card references and OCR load.</small></div>` : ''}
          ${this.scanError ? `<div class="scan-error">${escapeHtml(this.scanError)}</div>` : ''}
          ${!this.scanBusy && this.scanResults.length ? `<div class="scan-results">${this.scanResults.map((result, index) => `
            <article class="scan-result ${result.confidence < 65 ? 'needs-review' : ''}">
              <img src="${result.preview}" alt="Detected card ${index + 1}">
              <div class="scan-fields">
                <label><span>Card</span><select data-action="scan-card" data-index="${index}">${cardOptions.map((name) => `<option value="${escapeHtml(name)}" ${name === result.cardName ? 'selected' : ''}>${escapeHtml(name)}</option>`).join('')}</select></label>
                <label><span>Exact borders</span><select data-action="scan-border" data-index="${index}">${ALL_CARD_BORDER_VARIANTS.map((variant) => `<option value="${escapeHtml(variant.key)}" ${variant.key === borderKey(result.borders) ? 'selected' : ''}>${escapeHtml(variant.label)}</option>`).join('')}</select></label>
                <label class="scan-qty"><span>Copies</span><input type="number" min="1" max="999" value="${result.quantity}" data-action="scan-quantity" data-index="${index}"></label>
              </div>
              <div class="scan-meta"><strong>${result.confidence}% confidence</strong><span>${escapeHtml(result.displayedRarity ? `Read ${result.displayedRarity}` : 'Rarity OCR unavailable')}</span><small>${escapeHtml(result.method)}</small>${result.alternatives.length ? `<small>Other art matches: ${escapeHtml(result.alternatives.join(', '))}</small>` : ''}</div>
            </article>
          `).join('')}</div>` : ''}
          <footer class="scan-actions">
            <button data-action="scan-close" ${this.scanBusy ? 'disabled' : ''}>Cancel</button>
            <button data-action="scan-add" ${this.scanBusy || !this.scanResults.length ? 'disabled' : ''}>Add to Inventory</button>
            <button class="primary" data-action="scan-replace" ${this.scanBusy || !this.scanResults.length ? 'disabled' : ''}>Replace Card Inventory</button>
          </footer>
        </section>
      </div>
    `
  }

  private async startInventoryScan(file: File) {
    this.scanOpen = true
    this.scanBusy = true
    this.scanError = ''
    this.scanResults = []
    this.scanProgressText = 'Finding the inventory grid…'
    this.render()
    try {
      this.scanResults = await scanInventoryScreenshot(file, (progress) => {
        this.scanProgressText = progress.message
        const node = this.root.querySelector<HTMLElement>('[data-scan-progress]')
        if (node) node.textContent = progress.message
      })
    } catch (error) {
      this.scanError = error instanceof Error ? error.message : 'The screenshot could not be imported.'
    } finally {
      this.scanBusy = false
      this.render()
    }
  }

  private applyScanResults(replaceCards: boolean) {
    if (this.scanBusy || !this.scanResults.length) return
    const variants = new Map<string, OwnedCard>()
    if (!replaceCards) {
      for (const card of this.state.inventory.cards) variants.set(cardVariantKey(card.cardName, card.borders), { ...card, borders: canonicalBorders(card.borders) })
    }
    for (const result of this.scanResults) {
      if (!cards.some((card) => card.name === result.cardName)) continue
      const borders = canonicalBorders(result.borders)
      const key = cardVariantKey(result.cardName, borders)
      const quantity = Math.max(1, Math.min(999, Math.floor(result.quantity || 1)))
      const existing = variants.get(key)
      if (existing) existing.quantity = Math.min(999, existing.quantity + quantity)
      else variants.set(key, { cardName: result.cardName, borders, quantity, locked: false, lockedPosition: null })
    }
    this.state.inventory.cards = [...variants.values()].sort((left, right) => left.cardName.localeCompare(right.cardName) || borderKey(left.borders).localeCompare(borderKey(right.borders)))
    this.persist()
    this.scanOpen = false
    this.scanResults = []
    this.render()
  }

  private setDeckAura(kind: 'stat' | 'ability', selection: AuraSelection | null) {
    if (kind === 'stat') this.state.currentDeck.statAura = selection
    else this.state.currentDeck.abilityAura = selection
    this.persist(); this.render()
  }

  private startSearch() {
    this.error = ''
    this.results = []
    this.progress = null
    this.tab = 'optimize'
    this.runWorker({ kind: 'search', inventory: structuredClone(this.state.inventory) })
  }

  private startReplacement(slot: DeckSlot) {
    if (this.state.currentDeck.cards.length !== 4) return
    this.error = ''
    this.replacementSlot = slot
    this.replacementResults = []
    this.replacementBaseline = null
    this.runWorker({ kind: 'replacement', inventory: structuredClone(this.state.inventory), currentLoadout: structuredClone(this.state.currentDeck), slot })
  }

  private runWorker(request: import('./app-types').OptimizerRequest) {
    this.cancelWorker(false)
    this.worker = new Worker(new URL('./optimizer-worker.ts', import.meta.url), { type: 'module' })
    this.worker.onmessage = (event: MessageEvent<WorkerOutbound>) => {
      const message = event.data
      if (message.type === 'progress') {
        this.progress = message.progress
        this.render()
      } else if (message.type === 'search-result') {
        this.results = message.results
        this.progress = null
        this.finishWorker()
        this.render()
      } else if (message.type === 'replacement-result') {
        this.replacementBaseline = message.baseline
        this.replacementResults = message.results
        this.progress = null
        this.finishWorker()
        this.render()
      } else if (message.type === 'error') {
        this.error = message.message
        this.progress = null
        this.finishWorker()
        this.render()
      }
    }
    this.worker.onerror = (event) => {
      this.error = event.message || 'Optimizer worker failed.'
      this.progress = null
      this.finishWorker()
      this.render()
    }
    this.worker.postMessage({ type: 'run', request })
    this.render()
  }

  private cancelWorker(render = true) {
    if (this.worker) this.worker.terminate()
    this.worker = null
    this.progress = null
    if (render) this.render()
  }

  private finishWorker() {
    if (this.worker) this.worker.terminate()
    this.worker = null
  }

  private resultById(id: string) {
    return this.results.find((result) => result.id === id)
  }

  private useResult(id: string) {
    const result = this.resultById(id)
    if (!result) return
    this.state.currentDeck = structuredClone(result.loadout)
    this.persist(); this.tab = 'decks'; this.render()
  }

  private saveResult(id: string) {
    const result = this.resultById(id)
    if (!result) return
    const name = result.loadout.cards.map((card) => card.cardName).join(' / ')
    this.state.favorites.unshift(makeFavorite(name, result.loadout))
    this.persist(); this.render()
  }

  private saveCurrent() {
    if (this.state.currentDeck.cards.length !== 4) return
    const input = document.getElementById('favorite-name') as HTMLInputElement | null
    const name = input?.value || deckLabel(this.state.currentDeck)
    this.state.favorites.unshift(makeFavorite(name, this.state.currentDeck))
    this.persist(); this.render()
  }

  private loadFavorite(id: string) {
    const favorite = this.state.favorites.find((entry) => entry.id === id)
    if (!favorite) return
    this.state.currentDeck = structuredClone(favorite.loadout)
    this.persist(); this.render()
  }

  private deleteFavorite(id: string) {
    this.state.favorites = this.state.favorites.filter((entry) => entry.id !== id)
    this.persist(); this.render()
  }

  private useReplacement(index: number) {
    const result = this.replacementResults[index]
    if (!result) return
    this.state.currentDeck = structuredClone(result.loadout)
    this.replacementResults = []
    this.replacementBaseline = null
    this.persist(); this.render()
  }
}
