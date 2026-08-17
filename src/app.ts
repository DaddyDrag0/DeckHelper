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
import type { AuraBorderName, AuraSelection, BorderName, TeamCard, TeamLoadout } from './types'
import { exportInventoryCode, importInventoryCode, loadState, makeFavorite, saveState } from './storage'
import { auraLabel, borderLabel, deckLabel, escapeHtml, formatCompact, formatNumber, thumbnail } from './ui/format'
import { borderKey, cardVariantKey, canonicalBorders, firstUnusedBorderVariant, teamCardVariantKey } from './card-variants'
import { encodeDepthsTeam } from './depths-export'
import { depthSelectableAuras, depthSelectableCards } from './selectable'
import { isDepthsSourceEligible, MAX_DEPTH_BANS } from './engine/depths'

const CARD_BORDERS: BorderName[] = ['Platinum', 'Crystal', 'Ruby', 'Galaxy']
const AURA_BORDERS: AuraOwnedBorder[] = ['Base', 'Platinum', 'Crystal', 'Galaxy']

type Tab = 'pool' | 'auras' | 'optimize' | 'decks'

export class DeckHelperApp {
  private state: AppState = loadState()
  private tab: Tab = 'pool'
  private cardSearch = ''
  private poolSearch = ''
  private poolBorders = new Map<string, BorderName[]>()
  private auraBorderDraft = new Map<string, AuraOwnedBorder>()
  private auraSearch = ''
  private depthBanQuery = ''
  private inventoryCodeText = ''
  private inventoryCodeStatus = ''
  private worker: Worker | null = null
  private progress: OptimizerProgress | null = null
  private results: RankedTeam[] = []
  private replacementResults: ReplacementResult[] = []
  private replacementBaseline: TeamMetrics | null = null
  private replacementSlot: DeckSlot | null = null
  private error = ''
  private searchMode: 'fast' | 'full' = 'full'

  constructor(private root: HTMLElement) {
    this.syncCurrentDeck()
    this.root.addEventListener('click', (event) => this.onClick(event))
    this.root.addEventListener('change', (event) => this.onChange(event))
    this.root.addEventListener('input', (event) => this.onInput(event))
    this.root.addEventListener('dragstart', (event) => this.onDragStart(event))
    this.root.addEventListener('dragover', (event) => this.onDragOver(event))
    this.root.addEventListener('drop', (event) => this.onDrop(event))
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
    const workspace = this.tab === 'pool' ? this.renderPool() : this.tab === 'auras' ? this.renderAuras() : this.tab === 'optimize' ? this.renderOptimize() : this.renderDecks()
    this.root.innerHTML = `
      <div class="app-shell">
        <header class="topbar">
          <div>
            <div class="eyebrow">Card Fantasy RNG</div>
            <h1>DeckHelper</h1>
          </div>
          <div class="top-stats">
            <span><b>${this.state.inventory.cards.reduce((sum, card) => sum + card.quantity, 0)}</b> owned copies</span>
            <span><b>${this.poolCatalogCards().length}</b> cards available</span>
            <span><b>${this.state.favorites.length}</b> saved decks</span>
          </div>
        </header>
        ${this.error ? `<div class="error-banner">${escapeHtml(this.error)}<button data-action="clear-error">×</button></div>` : ''}
        <main class="workspace-layout">
          <section class="workspace-left">
            <nav class="workspace-tabs">
              ${this.tabButton('pool', 'Cards')}
              ${this.tabButton('auras', 'Auras')}
              ${this.tabButton('optimize', 'Helper')}
              ${this.tabButton('decks', 'Saved Decks')}
            </nav>
            <div class="workspace-content">${workspace}</div>
          </section>
          <aside class="inventory-side" data-drop-zone="inventory">${this.renderInventory()}</aside>
        </main>
      </div>
    `
  }

  private tabButton(tab: Tab, label: string) {
    const count = tab === 'pool' ? this.poolCatalogCards().length : tab === 'auras' ? this.state.inventory.statAuras.length + this.state.inventory.abilityAuras.length : tab === 'decks' ? this.state.favorites.length : this.results.length
    return `<button class="workspace-tab ${this.tab === tab ? 'active' : ''}" data-action="tab" data-tab="${tab}"><span>${label}</span><b>${count}</b></button>`
  }

  private borderGradient(borders: BorderName[]): string {
    const palettes: Record<BorderName, string[]> = {
      Platinum: ['#ff5a5a', '#ffff5a', '#5aff5a', '#5affff', '#5a5aff', '#ff5aff'],
      Crystal: ['#5ad3ff', '#5a6bff', '#5ae9ff'],
      Ruby: ['#550012', '#b90028', '#ff3755', '#ff96a5', '#a50023'],
      Galaxy: ['#4f72ff', '#6947ff', '#a342ff', '#e45cff', '#ff3f8b', '#ff4d5f'],
    }
    const colors = canonicalBorders(borders).flatMap((border) => palettes[border])
    if (!colors.length) return 'linear-gradient(135deg, #3a4558, #161d28)'
    return `conic-gradient(from 12deg, ${[...colors, colors[0]].join(', ')})`
  }

  private renderCardVisual(cardName: string, borders: BorderName[], compact = false) {
    const definition = cards.find((card) => card.name === cardName)
    const image = definition ? thumbnail(definition.imageAssetId) : ''
    const borderText = borderLabel(borders)
    return `
      <div class="card-art-frame ${compact ? 'compact' : ''} ${borders.includes('Galaxy') ? 'galaxy' : ''}" style="background:${escapeHtml(this.borderGradient(borders))}" title="${escapeHtml(`${cardName} · ${borderText}`)}">
        <div class="card-art-inner">
          ${image ? `<img src="${escapeHtml(image)}" alt="${escapeHtml(cardName)}">` : '<span class="missing-art">?</span>'}
          ${!compact ? `<span class="art-border-label">${escapeHtml(borderText)}</span>` : ''}
        </div>
      </div>
    `
  }

  private renderInventory() {
    const query = this.cardSearch.trim().toLowerCase()
    const variants = [...this.state.inventory.cards]
      .filter((owned) => {
        const definition = cards.find((card) => card.name === owned.cardName)
        return !query || owned.cardName.toLowerCase().includes(query) || (definition?.ability || '').toLowerCase().includes(query) || borderLabel(owned.borders).toLowerCase().includes(query)
      })
      .sort((left, right) => left.cardName.localeCompare(right.cardName) || borderKey(left.borders).localeCompare(borderKey(right.borders)))
    return `
      <div class="inventory-side-head">
        <div><span class="eyebrow">Drop destination</span><h2>Your Inventory</h2></div>
        <p>Drag cards from the Cards tab into this panel. Each exact border combination is stored separately; dropping the same variant again increases its quantity.</p>
        <div class="inventory-drop-hint">Drop Cards-tab cards anywhere in this panel</div>
      </div>
      <details class="inventory-code-panel">
        <summary>Inventory Code <span>backup / transfer</span></summary>
        <div class="inventory-code-body">
          <p>Copy this code somewhere safe, or paste a saved code below. Loading replaces Your Inventory only; saved decks are kept.</p>
          <textarea id="inventory-code-input" spellcheck="false" placeholder="DHINV1:...">${escapeHtml(this.inventoryCodeText)}</textarea>
          <div class="inventory-code-actions">
            <button class="primary" data-action="inventory-code-export">Copy Current Inventory</button>
            <button data-action="inventory-code-load" ${this.inventoryCodeText.trim() ? '' : 'disabled'}>Load Code</button>
            <button class="subtle" data-action="inventory-code-clear" ${this.inventoryCodeText ? '' : 'disabled'}>Clear</button>
          </div>
          ${this.inventoryCodeStatus ? `<small class="inventory-code-status">${escapeHtml(this.inventoryCodeStatus)}</small>` : ''}
        </div>
      </details>
      <label class="inventory-search"><span>Search inventory</span><input id="card-search" value="${escapeHtml(this.cardSearch)}" placeholder="Name, ability, or border"></label>
      <div class="inventory-variant-list">
        ${variants.length ? variants.map((owned) => this.renderInventoryCard(owned)).join('') : `<div class="inventory-empty">${this.state.inventory.cards.length ? 'No variants match this search.' : 'Add your first card above.'}</div>`}
      </div>
    `
  }

  private renderInventoryCard(owned: OwnedCard) {
    const definition = cards.find((card) => card.name === owned.cardName)
    const encodedKey = encodeURIComponent(cardVariantKey(owned.cardName, owned.borders))
    return `
      <article class="owned-variant-card" draggable="true" data-drag-card="${escapeHtml(encodedKey)}" data-drag-origin="inventory">
        <div class="owned-card-top">
          ${this.renderCardVisual(owned.cardName, owned.borders)}
          <div class="owned-card-info">
            <strong>${escapeHtml(owned.cardName)}</strong>
            <span>${escapeHtml(borderLabel(owned.borders))}</span>
            <small>${escapeHtml(definition?.ability || 'No ability')}</small>
            <div class="copy-line"><b>×${owned.quantity}</b><span>drag to deck</span></div>
          </div>
        </div>
        <div class="border-picker compact-picker">
          ${CARD_BORDERS.map((border) => `<label><input type="checkbox" data-action="card-border" data-key="${escapeHtml(encodedKey)}" data-border="${border}" ${owned.borders.includes(border) ? 'checked' : ''}><span>${border[0]}</span></label>`).join('')}
        </div>
        <div class="variant-controls">
          <label class="quantity-field"><span>Qty</span><input type="number" min="1" max="999" step="1" value="${owned.quantity}" data-action="card-quantity" data-key="${escapeHtml(encodedKey)}"></label>
          <label class="lock-check"><input type="checkbox" data-action="card-lock" data-key="${escapeHtml(encodedKey)}" ${owned.locked ? 'checked' : ''}> Lock</label>
          <select class="position-select" data-action="card-position" data-key="${escapeHtml(encodedKey)}">
            <option value="">Any pos.</option>
            ${[0, 1, 2, 3].map((position) => `<option value="${position}" ${owned.lockedPosition === position ? 'selected' : ''}>Pos. ${position + 1}</option>`).join('')}
          </select>
          <button class="danger subtle" data-action="remove-card" data-key="${escapeHtml(encodedKey)}">Remove</button>
        </div>
      </article>
    `
  }

  private poolCatalogCards() {
    return depthSelectableCards
  }

  private filteredPoolCards() {
    const query = this.poolSearch.trim().toLowerCase()
    return this.poolCatalogCards().filter((card) => !query
      || card.name.toLowerCase().includes(query)
      || (card.ability || '').toLowerCase().includes(query)
      || (card.weather || '').toLowerCase().includes(query)
      || (card.pack || '').toLowerCase().includes(query))
  }

  private poolBordersFor(cardName: string): BorderName[] {
    return canonicalBorders(this.poolBorders.get(cardName) ?? [])
  }

  private poolPayload(cardName: string): string {
    return encodeURIComponent(JSON.stringify({ cardName, borders: this.poolBordersFor(cardName) }))
  }

  private borderRarityMultiplier(borders: BorderName[]): number {
    const multipliers: Record<BorderName, number> = { Platinum: 100, Crystal: 10_000, Ruby: 100_000, Galaxy: 1_000_000 }
    return canonicalBorders(borders).reduce((value, border) => value * multipliers[border], 1)
  }

  private renderPoolCard(card: (typeof cards)[number]) {
    const borders = this.poolBordersFor(card.name)
    const key = cardVariantKey(card.name, borders)
    const owned = this.state.inventory.cards.find((entry) => cardVariantKey(entry.cardName, entry.borders) === key)
    const effectiveRarity = card.rarity * this.borderRarityMultiplier(borders)
    return `
      <article class="pool-catalog-card" draggable="true" data-drag-origin="pool" data-drag-card="${escapeHtml(this.poolPayload(card.name))}">
        ${this.renderCardVisual(card.name, borders)}
        <div class="pool-card-info">
          <strong>${escapeHtml(card.name)}</strong>
          <span>${escapeHtml(card.ability || 'No ability')}</span>
          <small>1/${formatCompact(effectiveRarity)}</small>
        </div>
        <div class="pool-border-picker" title="Choose the exact borders before dragging">
          ${CARD_BORDERS.map((border) => `<label class="pool-border-${border.toLowerCase()}"><input type="checkbox" data-action="pool-border" data-name="${escapeHtml(card.name)}" data-border="${border}" ${borders.includes(border) ? 'checked' : ''}><span>${border[0]}</span></label>`).join('')}
        </div>
        <div class="pool-card-foot">
          <span>${owned ? `Owned ×${owned.quantity}` : 'Not owned'}</span>
          <button data-action="pool-add-selected" data-name="${escapeHtml(card.name)}" title="Add this selected variant to inventory">Add →</button>
        </div>
      </article>
    `
  }

  private renderPool() {
    const visible = this.filteredPoolCards()
    const total = this.poolCatalogCards().length
    return `
      <section class="page-head split">
        <div><h2>Cards</h2></div>
      </section>
      <section class="panel pool-catalog">
        <label class="pool-search"><span>Search Cards</span><input id="pool-search" value="${escapeHtml(this.poolSearch)}" placeholder="Card name, ability, weather, or pack"></label>
        <div class="pool-catalog-summary"><strong>${visible.length}</strong><span>of ${total} cards shown</span><em>Border selection changes the card frame before you drag it.</em></div>
        <div class="pool-catalog-grid">${visible.map((card) => this.renderPoolCard(card)).join('')}</div>
      </section>
    `
  }

  private renderAuras() {
    const query = this.auraSearch.trim().toLowerCase()
    const visible = depthSelectableAuras.filter((aura) => !query || aura.name.toLowerCase().includes(query) || (aura.skillName || '').toLowerCase().includes(query))
    const ownedCount = this.state.inventory.statAuras.length + this.state.inventory.abilityAuras.length
    return `
      <section class="page-head split">
        <div><h2>Auras</h2></div>
      </section>
      <section class="panel aura-workspace">
        <label class="inventory-search aura-workspace-search"><span>Search Auras</span><input id="aura-search" value="${escapeHtml(this.auraSearch)}" placeholder="Aura name or skill"></label>
        <div class="aura-workspace-summary"><strong>${visible.length}</strong><span>of ${depthSelectableAuras.length} auras shown</span><em>${ownedCount} owned</em></div>
        <div class="aura-columns">
          <div class="aura-column">
            <div class="aura-column-head"><strong>Stat Auras</strong><span>${this.state.inventory.statAuras.length} owned</span></div>
            <div class="aura-card-grid">${visible.filter((aura) => aura.type === 'Stat').map((aura) => this.renderInventoryAura(aura.name, 'stat')).join('')}</div>
          </div>
          <div class="aura-column">
            <div class="aura-column-head"><strong>Ability Auras</strong><span>${this.state.inventory.abilityAuras.length} owned</span></div>
            <div class="aura-card-grid">${visible.filter((aura) => aura.type === 'Skill').map((aura) => this.renderInventoryAura(aura.name, 'ability')).join('')}</div>
          </div>
        </div>
      </section>
    `
  }

  private renderInventoryAura(name: string, type: 'stat' | 'ability') {
    const definition = auras.find((aura) => aura.name === name)!
    const ownedList = type === 'stat' ? this.state.inventory.statAuras : this.state.inventory.abilityAuras
    const owned = ownedList.find((aura) => aura.auraName === name)
    const image = thumbnail(definition.imageAssetId)
    const draftKey = `${type}:${name}`
    const selectedBorder = owned?.borders[0] ?? this.auraBorderDraft.get(draftKey) ?? 'Base'
    return `
      <article class="aura-catalog-row ${owned ? 'owned' : ''}">
        <div class="thumb small">${image ? `<img src="${escapeHtml(image)}" alt="">` : '<span>?</span>'}</div>
        <div class="aura-catalog-main">
          <div class="item-main"><strong>${escapeHtml(name)}</strong><small>${escapeHtml(definition.skillName || definition.type || '')}</small></div>
          <div class="aura-single-border" aria-label="Aura border">
            ${AURA_BORDERS.map((border) => `<button type="button" class="aura-border-choice ${selectedBorder === border ? 'active' : ''}" data-action="aura-border-choice" data-kind="${type}" data-name="${escapeHtml(name)}" data-border="${border}" title="${border === 'Base' ? 'No aura border' : border}">${border === 'Base' ? 'Base' : border[0]}</button>`).join('')}
          </div>
          <div class="aura-catalog-actions">
            ${owned
              ? `<span class="aura-owned-pill">Owned · ${escapeHtml(selectedBorder)}</span><label class="lock-check"><input type="checkbox" data-action="aura-lock" data-kind="${type}" data-name="${escapeHtml(name)}" ${owned.locked ? 'checked' : ''}> Lock</label><button class="danger subtle" data-action="remove-aura" data-kind="${type}" data-name="${escapeHtml(name)}">Remove</button>`
              : `<span class="aura-draft-label">Add as ${escapeHtml(selectedBorder)}</span><button class="primary compact" data-action="add-aura" data-kind="${type}" data-name="${escapeHtml(name)}" data-border="${selectedBorder}">Add Aura</button>`}
          </div>
        </div>
      </article>
    `
  }

  private renderOptimize() {
    const searchInventory = this.state.inventory
    const lockedCards = searchInventory.cards.filter((card) => card.locked || card.lockedPosition !== null)
    const lockedStat = searchInventory.statAuras.find((aura) => aura.locked)
    const lockedAbility = searchInventory.abilityAuras.find((aura) => aura.locked)
    const banQuery = this.depthBanQuery.trim().toLowerCase()
    const banCandidates = cards
      .filter(isDepthsSourceEligible)
      .filter((card) => !this.state.depthBans.includes(card.name))
      .filter((card) => banQuery && (card.name.toLowerCase().includes(banQuery) || (card.ability || '').toLowerCase().includes(banQuery)))
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, 8)
    const sorted = this.recommendedResults()
    return `
      <section class="page-head split">
        <div><h2>Helper</h2></div>
        <div class="actions search-mode-actions">${this.worker ? `<button class="danger" data-action="cancel-search">Cancel Search</button>` : `<button data-action="start-search-fast" ${this.state.inventory.cards.reduce((sum, card) => sum + card.quantity, 0) < 4 ? 'disabled' : ''}>Fast Search</button><button class="primary" data-action="start-search-full" ${this.state.inventory.cards.reduce((sum, card) => sum + card.quantity, 0) < 4 ? 'disabled' : ''}>Full Depths Search</button><small>Fast = approximate / lighter · Full = 15 real Depths runs per finalist</small>`}</div>
      </section>
      <section class="optimizer-pool-preview panel-soft">
        <div><strong>Your Inventory</strong><span>${this.state.inventory.cards.reduce((sum, card) => sum + card.quantity, 0)} copies · ${searchInventory.cards.length} exact variants</span></div>
        <div class="mini-card-row">${searchInventory.cards.slice(0, 12).map((card) => this.renderCardVisual(card.cardName, card.borders, true)).join('')}${searchInventory.cards.length > 12 ? `<b>+${searchInventory.cards.length - 12}</b>` : ''}</div>
      </section>
      <section class="lock-summary panel">
        <div><span>Locked cards</span><strong>${lockedCards.length ? lockedCards.map((card) => `${escapeHtml(card.cardName)} · ${escapeHtml(borderLabel(card.borders))}${card.lockedPosition !== null ? ` (#${card.lockedPosition + 1})` : ''}`).join(', ') : 'None'}</strong></div>
        <div><span>Stat Aura</span><strong>${lockedStat ? escapeHtml(lockedStat.auraName) : 'Auto'}</strong></div>
        <div><span>Ability Aura</span><strong>${lockedAbility ? escapeHtml(lockedAbility.auraName) : 'Auto'}</strong></div>
      </section>
      <section class="depth-ban-panel panel">
        <div class="depth-ban-head">
          <div><strong>Depth Bans</strong><span>Optional · default game bans stay active separately</span></div>
          <div>${this.state.depthBans.length ? `<button class="subtle" data-action="depth-ban-clear" ${this.worker ? 'disabled' : ''}>Clear</button>` : ''}<b>${this.state.depthBans.length}/${MAX_DEPTH_BANS}</b></div>
        </div>
        ${this.state.depthBans.length ? `<div class="depth-ban-chips">${this.state.depthBans.map((name) => `<button data-action="depth-ban-remove" data-name="${escapeHtml(name)}" ${this.worker ? 'disabled' : ''}>${escapeHtml(name)} ×</button>`).join('')}</div>` : ''}
        <div class="depth-ban-search">
          <input id="depth-ban-search" value="${escapeHtml(this.depthBanQuery)}" placeholder="${this.state.depthBans.length >= MAX_DEPTH_BANS ? '10/10 bans selected' : 'Search an enemy card to ban'}" autocomplete="off" ${this.worker || this.state.depthBans.length >= MAX_DEPTH_BANS ? 'disabled' : ''}>
          ${banQuery && !this.worker && this.state.depthBans.length < MAX_DEPTH_BANS ? `<div class="depth-ban-suggestions">${banCandidates.length ? banCandidates.map((card) => `<button data-action="depth-ban-add" data-name="${escapeHtml(card.name)}"><strong>${escapeHtml(card.name)}</strong><span>${escapeHtml(card.ability || 'No ability')}</span></button>`).join('') : '<small>No eligible Depth enemies found.</small>'}</div>` : ''}
        </div>
      </section>
      ${this.progress ? this.renderProgress(this.progress) : ''}
      ${this.results.length ? `
        <section class="results-head"><h3>Top 10 Recommended Teams</h3><span>${this.searchMode === 'fast' ? 'Fast approximate shortlist · export to Depths for proper testing' : 'Full Depths shortlist · export to Depths for further testing'}</span></section>
        <section class="result-list">${sorted.map((result) => this.renderResult(result)).join('')}</section>
      ` : `<section class="empty-state panel"><strong>${this.state.inventory.cards.reduce((sum, card) => sum + card.quantity, 0) < 4 ? 'Your Inventory needs at least 4 copies.' : 'No optimizer results yet.'}</strong><span>${this.state.inventory.cards.reduce((sum, card) => sum + card.quantity, 0) < 4 ? 'Drag cards from the Cards tab into Your Inventory on the right.' : 'Start the search when you are ready.'}</span></section>`}
    `
  }

  private renderProgress(progress: OptimizerProgress) {
    const phaseLabel: Record<OptimizerProgress['phase'], string> = {
      prepare: 'Preparing candidates', quick: 'Quick testing', middle: 'Refining candidates', order: 'Optimizing order + auras', final: 'Final simulations', replacement: 'Testing replacements',
    }
    const currentBestMetric = (progress.phase === 'final' || progress.phase === 'replacement') && this.searchMode === 'full'
      ? `Depths median ${formatNumber(progress.currentBest?.metrics.medianDepth ?? 0)}`
      : `${this.searchMode === 'fast' && progress.phase === 'final' ? 'Approx. power estimate' : 'Quick power estimate'} ~ ${formatNumber(progress.currentBest?.metrics.medianDepth ?? 0)}`
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
        ${progress.currentBest ? `<div class="current-best"><span>Current best</span><strong>${escapeHtml(deckLabel(progress.currentBest.loadout))}</strong><b>${escapeHtml(currentBestMetric)}</b></div>` : ''}
      </section>
    `
  }

  private recommendedResults() {
    return [...this.results]
      .sort((a, b) =>
        b.metrics.averageDepth - a.metrics.averageDepth
        || b.metrics.medianDepth - a.metrics.medianDepth
        || b.metrics.minimumDepth - a.metrics.minimumDepth
        || a.metrics.consistency - b.metrics.consistency
        || a.id.localeCompare(b.id),
      )
      .slice(0, 10)
  }

  private renderResult(result: RankedTeam) {
    return `
      <article class="result-card">
        <div class="result-content">
          <div class="team-slots">${result.loadout.cards.map((card, index) => {
            const definition = cards.find((entry) => entry.name === card.cardName)
            return `<div class="team-slot">${this.renderCardVisual(card.cardName, card.borders, true)}<div><span>Slot ${index + 1}</span><strong>${escapeHtml(card.cardName)}</strong><small>${escapeHtml(borderLabel(card.borders))}</small><small class="team-slot-support">Support / ability: ${escapeHtml(definition?.ability || 'None')}</small></div></div>`
          }).join('')}</div>
          <div class="aura-line"><span>Stat: <b>${escapeHtml(auraLabel(result.loadout.statAura))}</b></span><span>Ability: <b>${escapeHtml(auraLabel(result.loadout.abilityAura))}</b></span>${this.searchMode === 'full' ? `<span>Median Depth: <b>${formatNumber(result.metrics.medianDepth)}</b></span>` : ''}</div>
          ${result.metrics.trusted ? '' : `<div class="warning">Unverified mechanics: ${escapeHtml(result.metrics.unsupportedAbilities.join(', '))}</div>`}
        </div>
        <div class="result-actions"><button class="primary" data-action="export-result" data-result="${escapeHtml(result.id)}">Copy Export Code</button><button data-action="save-result" data-result="${escapeHtml(result.id)}">Save</button></div>
      </article>
    `
  }

  private renderDecks() {
    const deck = this.state.currentDeck
    const complete = deck.cards.length === 4
    return `
      <section class="page-head"><div><span class="eyebrow">Favorites</span><h2>Saved Decks</h2><p>Build the current deck by dragging owned variants from Your Inventory, then save or reload it exactly as configured.</p></div></section>
      <section class="panel current-deck saved-current">
        <div class="section-title"><div><h3>Current Deck</h3><span>${complete ? 'Ready to save' : `${deck.cards.length}/4 cards`}</span></div><span>Drag owned variants from the inventory on the right.</span></div>
        <div class="deck-editor">${[0, 1, 2, 3].map((slot) => this.renderDeckSlot(slot as DeckSlot)).join('')}</div>
        <div class="deck-aura-row">
          <label><span>Stat Aura</span>${this.renderAuraSelect('stat', deck.statAura)}</label>
          <label><span>Ability Aura</span>${this.renderAuraSelect('ability', deck.abilityAura)}</label>
        </div>
        <div class="save-row"><input id="favorite-name" placeholder="Deck name"><button class="primary" data-action="save-current" ${complete ? '' : 'disabled'}>Save Deck</button></div>
      </section>
      ${this.progress?.phase === 'replacement' ? this.renderProgress(this.progress) : ''}
      ${this.replacementResults.length ? this.renderReplacementResults() : ''}
      <section class="favorites-section">
        <div class="results-head"><h3>Saved</h3><span>${this.state.favorites.length} decks</span></div>
        ${this.state.favorites.length ? `<div class="favorite-list">${this.state.favorites.map((favorite) => `
          <article class="favorite-card">
            <div class="favorite-team">${favorite.loadout.cards.map((card) => this.renderCardVisual(card.cardName, card.borders, true)).join('')}</div>
            <div class="favorite-info"><strong>${escapeHtml(favorite.name)}</strong><span>${escapeHtml(deckLabel(favorite.loadout))}</span><small>${escapeHtml(auraLabel(favorite.loadout.statAura))} · ${escapeHtml(auraLabel(favorite.loadout.abilityAura))}</small></div>
            <div class="favorite-actions"><button data-action="load-favorite" data-id="${escapeHtml(favorite.id)}">Load</button><button class="danger subtle" data-action="delete-favorite" data-id="${escapeHtml(favorite.id)}">Delete</button></div>
          </article>`).join('')}</div>` : `<div class="empty-state panel"><span>No saved decks yet.</span></div>`}
      </section>
    `
  }

  private renderDeckSlot(slot: DeckSlot) {
    const current = this.state.currentDeck.cards[slot]
    const isNextSlot = slot <= this.state.currentDeck.cards.length
    return `
      <div class="deck-drop-slot ${current ? 'filled' : ''} ${isNextSlot ? '' : 'locked-drop'}" ${isNextSlot ? `data-drop-zone="deck" data-slot="${slot}"` : ''}>
        <span class="slot-number">${slot + 1}</span>
        ${current ? `${this.renderCardVisual(current.cardName, current.borders)}<strong>${escapeHtml(current.cardName)}</strong><span>${escapeHtml(borderLabel(current.borders))}<button class="slot-clear" data-action="deck-clear" data-slot="${slot}" title="Clear slot">×</button></span><button class="replacement-button" data-action="replacement" data-slot="${slot}" ${this.state.currentDeck.cards.length === 4 && !this.worker ? '' : 'disabled'}>Best replacement</button>` : `<div class="slot-placeholder"><b>${isNextSlot ? 'Drop card here' : 'Fill earlier slots first'}</b><span>${isNextSlot ? 'Owned inventory card' : ''}</span></div>`}
      </div>
    `
  }

  private renderAuraSelect(kind: 'stat' | 'ability', current?: AuraSelection | null) {
    const source = kind === 'stat' ? this.state.inventory.statAuras : this.state.inventory.abilityAuras
    const options = source.map((aura) => {
      const border = aura.borders[0] ?? 'Base'
      return { auraName: aura.auraName, border: border === 'Base' ? null : border as AuraBorderName }
    })
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
    } else if (target.id === 'pool-search') {
      this.poolSearch = target.value
      this.renderAndRefocus('pool-search')
    } else if (target.id === 'aura-search') {
      this.auraSearch = target.value
      this.renderAndRefocus('aura-search')
    } else if (target.id === 'depth-ban-search') {
      this.depthBanQuery = target.value
      this.renderAndRefocus('depth-ban-search')
    } else if (target.id === 'inventory-code-input') {
      this.inventoryCodeText = target.value
      this.inventoryCodeStatus = ''
    }
  }

  private onChange(event: Event) {
    const target = event.target
    if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) return
    const action = target.dataset.action
    if (action === 'pool-border' && target instanceof HTMLInputElement) this.togglePoolBorder(target.dataset.name || '', target.dataset.border as BorderName, target.checked)
    if (action === 'card-border' && target instanceof HTMLInputElement) this.toggleCardBorder(target.dataset.key || '', target.dataset.border as BorderName, target.checked)
    if (action === 'card-quantity' && target instanceof HTMLInputElement) this.setCardQuantity(target.dataset.key || '', target.value)
    if (action === 'card-lock' && target instanceof HTMLInputElement) this.toggleCardLock(target.dataset.key || '', target.checked)
    if (action === 'card-position' && target instanceof HTMLSelectElement) this.setCardPosition(target.dataset.key || '', target.value)
    if (action === 'aura-lock' && target instanceof HTMLInputElement) this.toggleAuraLock(target.dataset.kind as 'stat' | 'ability', target.dataset.name || '', target.checked)
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
    } else if (action === 'inventory-code-export') {
      void this.copyInventoryCode()
    } else if (action === 'inventory-code-load') {
      this.loadInventoryCode()
    } else if (action === 'inventory-code-clear') {
      this.inventoryCodeText = ''
      this.inventoryCodeStatus = ''
      this.render()
    } else if (action === 'pool-add-selected') this.addOwnedVariant(target.dataset.name || '', this.poolBordersFor(target.dataset.name || ''))
    else if (action === 'add-card') this.addCard(target.dataset.name || '')
    else if (action === 'remove-card') this.removeCard(target.dataset.key || '')
    else if (action === 'deck-clear') this.setDeckCard(Number(target.dataset.slot) as DeckSlot, '')
    else if (action === 'aura-border-choice') this.chooseAuraBorder(target.dataset.kind as 'stat' | 'ability', target.dataset.name || '', target.dataset.border as AuraOwnedBorder)
    else if (action === 'add-aura') this.addAura(target.dataset.kind as 'stat' | 'ability', target.dataset.name || '', target.dataset.border as AuraOwnedBorder)
    else if (action === 'remove-aura') this.removeAura(target.dataset.kind as 'stat' | 'ability', target.dataset.name || '')
    else if (action === 'depth-ban-add') this.addDepthBan(target.dataset.name || '')
    else if (action === 'depth-ban-remove') this.removeDepthBan(target.dataset.name || '')
    else if (action === 'depth-ban-clear') this.clearDepthBans()
    else if (action === 'start-search-fast') this.startSearch('fast')
    else if (action === 'start-search-full') this.startSearch('full')
    else if (action === 'cancel-search') this.cancelWorker()
    else if (action === 'export-result') this.exportResult(target.dataset.result || '')
    else if (action === 'save-result') this.saveResult(target.dataset.result || '')
    else if (action === 'save-current') this.saveCurrent()
    else if (action === 'load-favorite') this.loadFavorite(target.dataset.id || '')
    else if (action === 'delete-favorite') this.deleteFavorite(target.dataset.id || '')
    else if (action === 'replacement') this.startReplacement(Number(target.dataset.slot) as DeckSlot)
    else if (action === 'use-replacement') this.useReplacement(Number(target.dataset.index))
  }

  private onDragStart(event: DragEvent) {
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-drag-card]') : null
    if (!target || !event.dataTransfer) return
    const key = target.dataset.dragCard || ''
    const origin = target.dataset.dragOrigin || 'inventory'
    event.dataTransfer.setData('text/plain', `${origin}|${key}`)
    event.dataTransfer.effectAllowed = 'copy'
    target.classList.add('dragging')
    window.setTimeout(() => target.classList.remove('dragging'), 0)
  }

  private onDragOver(event: DragEvent) {
    const zone = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-drop-zone]') : null
    if (!zone) return
    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
  }

  private onDrop(event: DragEvent) {
    const zone = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-drop-zone]') : null
    if (!zone || !event.dataTransfer) return
    event.preventDefault()
    const raw = event.dataTransfer.getData('text/plain')
    const split = raw.indexOf('|')
    if (split < 0) return
    const origin = raw.slice(0, split)
    const encodedKey = raw.slice(split + 1)
    if (zone.dataset.dropZone === 'inventory') {
      if (origin === 'pool') this.addPoolPayload(encodedKey)
      return
    }
    if (zone.dataset.dropZone === 'deck' && origin === 'inventory') this.setDeckCard(Number(zone.dataset.slot) as DeckSlot, encodedKey)
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

  private async copyInventoryCode() {
    const code = exportInventoryCode(this.state.inventory)
    this.inventoryCodeText = code
    this.inventoryCodeStatus = 'Inventory code generated. Copy it somewhere safe.'
    this.render()
    try {
      await navigator.clipboard.writeText(code)
      this.inventoryCodeStatus = 'Copied to clipboard.'
      this.render()
    } catch {
      const textarea = document.getElementById('inventory-code-input') as HTMLTextAreaElement | null
      textarea?.focus()
      textarea?.select()
    }
  }

  private loadInventoryCode() {
    try {
      const inventory = importInventoryCode(this.inventoryCodeText)
      this.state.inventory = inventory
      this.results = []
      this.replacementResults = []
      this.replacementBaseline = null
      this.replacementSlot = null
      this.error = ''
      const copies = inventory.cards.reduce((sum, card) => sum + card.quantity, 0)
      this.inventoryCodeStatus = `Loaded ${copies} card ${copies === 1 ? 'copy' : 'copies'} across ${inventory.cards.length} exact variants.`
      this.persist()
      this.render()
    } catch (error) {
      this.inventoryCodeStatus = error instanceof Error ? error.message : 'Could not load that inventory code.'
      this.render()
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
    } else card.borders = nextBorders
    const remap = (slot: TeamCard): TeamCard => teamCardVariantKey(slot) === oldKey ? { cardName: card.cardName, borders: canonicalBorders(nextBorders) } : slot
    this.state.currentDeck.cards = this.state.currentDeck.cards.map(remap)
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

  private addAura(kind: 'stat' | 'ability', name: string, border: AuraOwnedBorder = 'Base') {
    const list = this.auraList(kind)
    if (!name || list.some((aura) => aura.auraName === name)) return
    const selectedBorder = AURA_BORDERS.includes(border) ? border : 'Base'
    list.push({ auraName: name, borders: [selectedBorder], locked: false })
    this.auraBorderDraft.delete(`${kind}:${name}`)
    this.persist(); this.render()
  }

  private removeAura(kind: 'stat' | 'ability', name: string) {
    if (kind === 'stat') this.state.inventory.statAuras = this.state.inventory.statAuras.filter((aura) => aura.auraName !== name)
    else this.state.inventory.abilityAuras = this.state.inventory.abilityAuras.filter((aura) => aura.auraName !== name)
    this.persist(); this.render()
  }

  private chooseAuraBorder(kind: 'stat' | 'ability', name: string, border: AuraOwnedBorder) {
    if (!name || !AURA_BORDERS.includes(border)) return
    const aura = this.auraList(kind).find((entry) => entry.auraName === name)
    if (!aura) {
      this.auraBorderDraft.set(`${kind}:${name}`, border)
      this.render()
      return
    }
    aura.borders = [border]
    const selection: AuraSelection = { auraName: name, border: border === 'Base' ? null : border as AuraBorderName }
    if (kind === 'stat' && this.state.currentDeck.statAura?.auraName === name) this.state.currentDeck.statAura = selection
    if (kind === 'ability' && this.state.currentDeck.abilityAura?.auraName === name) this.state.currentDeck.abilityAura = selection
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

  private togglePoolBorder(cardName: string, border: BorderName, checked: boolean) {
    if (!cardName || !CARD_BORDERS.includes(border)) return
    const current = this.poolBordersFor(cardName)
    const next = canonicalBorders(checked ? [...current, border] : current.filter((value) => value !== border))
    this.poolBorders.set(cardName, next)
    this.render()
  }

  private addOwnedVariant(cardName: string, borders: BorderName[]) {
    const definition = cards.find((card) => card.name === cardName)
    if (!definition || (definition.unobtainable && !definition.name.toLowerCase().includes('conqueror'))) return
    const normalized = canonicalBorders(borders)
    const key = cardVariantKey(cardName, normalized)
    const existing = this.state.inventory.cards.find((card) => cardVariantKey(card.cardName, card.borders) === key)
    if (existing) existing.quantity = Math.min(999, existing.quantity + 1)
    else this.state.inventory.cards.push({ cardName, quantity: 1, borders: normalized, locked: false, lockedPosition: null })
    this.error = ''
    this.persist(); this.render()
  }

  private addPoolPayload(encodedPayload: string) {
    try {
      const parsed = JSON.parse(decodeURIComponent(encodedPayload)) as { cardName?: unknown; borders?: unknown }
      if (typeof parsed.cardName !== 'string') return
      const borders = Array.isArray(parsed.borders)
        ? parsed.borders.filter((border): border is BorderName => CARD_BORDERS.includes(border as BorderName))
        : []
      this.addOwnedVariant(parsed.cardName, borders)
    } catch {
      return
    }
  }

  private setDeckAura(kind: 'stat' | 'ability', selection: AuraSelection | null) {
    if (kind === 'stat') this.state.currentDeck.statAura = selection
    else this.state.currentDeck.abilityAura = selection
    this.persist(); this.render()
  }

  private clearBanSensitiveResults() {
    this.results = []
    this.replacementResults = []
    this.replacementBaseline = null
    this.replacementSlot = null
  }

  private addDepthBan(name: string) {
    if (this.worker || this.state.depthBans.length >= MAX_DEPTH_BANS || this.state.depthBans.includes(name)) return
    const card = cards.find((candidate) => candidate.name === name)
    if (!card || !isDepthsSourceEligible(card)) return
    this.state.depthBans.push(name)
    this.depthBanQuery = ''
    this.clearBanSensitiveResults()
    this.persist(); this.render()
  }

  private removeDepthBan(name: string) {
    if (this.worker) return
    this.state.depthBans = this.state.depthBans.filter((entry) => entry !== name)
    this.clearBanSensitiveResults()
    this.persist(); this.render()
  }

  private clearDepthBans() {
    if (this.worker || !this.state.depthBans.length) return
    this.state.depthBans = []
    this.depthBanQuery = ''
    this.clearBanSensitiveResults()
    this.persist(); this.render()
  }

  private startSearch(mode: 'fast' | 'full') {
    this.error = ''
    this.results = []
    this.progress = null
    this.searchMode = mode
    this.tab = 'optimize'
    if (this.state.inventory.cards.reduce((sum, card) => sum + card.quantity, 0) < 4) {
      this.error = 'Add at least 4 owned copies to Your Inventory before optimizing.'
      this.render()
      return
    }
    this.runWorker({ kind: 'search', inventory: structuredClone(this.state.inventory), bannedCardNames: [...this.state.depthBans], settings: { mode } })
  }

  private startReplacement(slot: DeckSlot) {
    if (this.state.currentDeck.cards.length !== 4) return
    this.error = ''
    this.replacementSlot = slot
    this.replacementResults = []
    this.replacementBaseline = null
    this.runWorker({ kind: 'replacement', inventory: structuredClone(this.state.inventory), bannedCardNames: [...this.state.depthBans], currentLoadout: structuredClone(this.state.currentDeck), slot })
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

  private async exportResult(id: string) {
    const result = this.resultById(id)
    if (!result) return
    try {
      const code = encodeDepthsTeam(result.loadout)
      let copied = false
      try {
        await navigator.clipboard.writeText(code)
        copied = true
      } catch {
        const textarea = document.createElement('textarea')
        textarea.value = code
        textarea.setAttribute('readonly', '')
        textarea.style.position = 'fixed'
        textarea.style.opacity = '0'
        document.body.appendChild(textarea)
        textarea.select()
        copied = document.execCommand('copy')
        textarea.remove()
      }
      if (!copied) {
        window.prompt('Copy this Depths export code:', code)
        return
      }
      const button = this.root.querySelector<HTMLElement>(`[data-action="export-result"][data-result="${CSS.escape(id)}"]`)
      if (button) {
        const original = button.textContent || 'Copy Export Code'
        button.textContent = 'Copied!'
        window.setTimeout(() => {
          if (button.isConnected) button.textContent = original
        }, 1600)
      }
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Could not create this Depths export code.'
      this.render()
    }
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
    this.persist(); this.tab = 'pool'; this.render()
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
