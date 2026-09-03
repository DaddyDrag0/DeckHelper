import cards from './data/cards'
import abilities from './data/abilities'
import auras from './data/auras'
import type {
  AppState,
  AuraOwnedBorder,
  DeckSlot,
  OptimizerProgress,
  OptimizerRequest,
  OwnedAura,
  OwnedCard,
  RankedTeam,
  WorkerOutbound,
} from './app-types'
import type { AuraBorderName, AuraSelection, BorderName, TeamLoadout } from './types'
import { exportInventoryCode, importInventoryCode, loadState, makeFavorite, saveState } from './storage'
import { auraLabel, borderLabel, deckLabel, escapeHtml, formatCompact, formatNumber, thumbnail } from './ui/format'
import { cardVariantKey, canonicalBorders, teamCardVariantKey } from './card-variants'
import { encodeDepthsTeam } from './depths-export'
import { depthSelectableAuras, depthSelectableCards } from './selectable'
import { isDepthsSourceEligible, MAX_DEPTH_BANS } from './engine/depths'

const CARD_BORDERS: BorderName[] = ['Platinum', 'Crystal', 'Ruby', 'Galaxy']
const AURA_BORDERS: AuraOwnedBorder[] = ['Base', 'Platinum', 'Crystal', 'Galaxy']
const MAX_SELECTED_CARDS = 15
const MAX_STAT_AURAS = 4
type Tab = 'optimize' | 'inventory' | 'saved'

type AuraKind = 'stat' | 'ability'

function enc(value: string) {
  return encodeURIComponent(value)
}

function dec(value: string) {
  try { return decodeURIComponent(value) } catch { return value }
}

function cardDefinition(name: string) {
  return cards.find((card) => card.name === name)
}

export class DeckHelperRevamp {
  private state: AppState = loadState()
  private tab: Tab
  private inventorySearch = ''
  private catalogSearch = ''
  private auraSearch = ''
  private banSearch = ''
  private inventoryCodeText = ''
  private inventoryCodeStatus = ''
  private catalogBorders = new Map<string, BorderName[]>()
  private worker: Worker | null = null
  private progress: OptimizerProgress | null = null
  private results: RankedTeam[] = []
  private searchMode: 'fast' | 'full' = 'full'
  private error = ''

  constructor(private root: HTMLElement) {
    this.tab = 'inventory'
    this.root.addEventListener('click', (event) => this.onClick(event))
    this.root.addEventListener('input', (event) => this.onInput(event))
    this.root.addEventListener('change', (event) => this.onChange(event))
  }

  start() {
    this.sanitizeCurrentDeck()
    this.render()
  }

  private persist() {
    this.sanitizeCurrentDeck()
    saveState(this.state)
  }

  private sanitizeCurrentDeck() {
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
  }

  private ownedCopies() {
    return this.state.inventory.cards.reduce((sum, card) => sum + card.quantity, 0)
  }

  private lockedCards() {
    return this.state.inventory.cards.filter((card) => card.locked || card.lockedPosition !== null)
  }

  private borderGradient(borders: BorderName[]) {
    const palettes: Record<BorderName, string[]> = {
      Platinum: ['#ff6767', '#ffe05f', '#78ed82', '#64e2ff', '#7773ff', '#e66cff'],
      Crystal: ['#7be2ff', '#879cff', '#69d8ff'],
      Ruby: ['#8a1538', '#e62f5b', '#ff829e', '#b31f45'],
      Galaxy: ['#627dff', '#795cff', '#a959ff', '#e85cdd', '#ff5d88'],
    }
    const selected = canonicalBorders(borders).flatMap((border) => palettes[border])
    return selected.length ? `conic-gradient(from 20deg, ${[...selected, selected[0]].join(',')})` : 'linear-gradient(145deg,#303846,#171c25)'
  }

  private renderArt(name: string, borders: BorderName[], compact = false) {
    const definition = cardDefinition(name)
    const image = definition ? thumbnail(definition.imageAssetId) : ''
    return `<div class="rv-art ${compact ? 'compact' : ''}" style="background:${escapeHtml(this.borderGradient(borders))}"><div>${image ? `<img src="${escapeHtml(image)}" alt="${escapeHtml(name)}">` : '<span>?</span>'}</div></div>`
  }

  private render() {
    this.sanitizeCurrentDeck()
    const view = this.tab === 'inventory' ? this.renderInventory() : this.tab === 'saved' ? this.renderSaved() : this.renderOptimize()
    this.root.innerHTML = `
      <div class="rv-shell">
        <header class="rv-header">
          <div class="rv-brand">
            <div><strong>DeckHelper</strong><span>Card RNG Expansion</span></div>
          </div>
          <div class="rv-header-stats">
            <span><b>${this.ownedCopies()}/${MAX_SELECTED_CARDS}</b> cards</span>
            <span><b>${this.state.inventory.statAuras.length + this.state.inventory.abilityAuras.length}</b> auras</span>
            <span><b>${this.state.favorites.length}</b> saved</span>
          </div>
        </header>
        <nav class="rv-nav">
          ${this.navButton('inventory', 'Inventory', 'Step 1 · Add & manage cards')}
          ${this.navButton('optimize', 'Optimize', 'Step 2 · Find your best deck')}
          ${this.navButton('saved', 'Saved', 'Your saved decks')}
        </nav>
        ${this.error ? `<div class="rv-error"><span>${escapeHtml(this.error)}</span><button data-action="clear-error">×</button></div>` : ''}
        <main class="rv-main">${view}</main>
      </div>`
  }

  private navButton(tab: Tab, label: string, sub: string) {
    return `<button class="rv-nav-btn ${this.tab === tab ? 'active' : ''}" data-action="tab" data-tab="${tab}"><strong>${label}</strong><span>${sub}</span></button>`
  }

  private renderInventory() {
    const ownedQuery = this.inventorySearch.trim().toLowerCase()
    const owned = this.state.inventory.cards
      .filter((card) => {
        const def = cardDefinition(card.cardName)
        return !ownedQuery || card.cardName.toLowerCase().includes(ownedQuery) || (def?.ability || '').toLowerCase().includes(ownedQuery) || borderLabel(card.borders).toLowerCase().includes(ownedQuery)
      })
      .sort((a, b) => a.cardName.localeCompare(b.cardName) || borderLabel(a.borders).localeCompare(borderLabel(b.borders)))
    const query = this.catalogSearch.trim().toLowerCase()
    const catalog = depthSelectableCards
      .filter((card) => !query || card.name.toLowerCase().includes(query) || (card.ability || '').toLowerCase().includes(query) || (card.weather || '').toLowerCase().includes(query) || (card.pack || '').toLowerCase().includes(query))
      .sort((a, b) => b.rarity - a.rarity)

    return `
      <section class="rv-page-title">
        <div><span>Step 1</span><h1>Build your inventory</h1><p>Search a card, choose its borders, and click Add. No dragging required.</p></div>
        <button class="rv-primary" data-action="tab" data-tab="optimize" ${this.ownedCopies() < 4 ? 'disabled' : ''}>Go to Optimize →</button>
      </section>

      <section class="rv-panel rv-add-panel">
        <div class="rv-section-head"><div><h2>Add cards</h2><p>Border choices only apply to the card you add.</p></div><b>${catalog.length} results</b></div>
        <div class="rv-search"><span>⌕</span><input id="catalog-search" value="${escapeHtml(this.catalogSearch)}" placeholder="Search card, ability, weather, or pack…" autocomplete="off"></div>
        <div class="rv-catalog-grid">${catalog.map((card) => this.renderCatalogCard(card)).join('')}</div>
      </section>

      <section class="rv-panel">
        <div class="rv-section-head"><div><h2>Your cards</h2><p>Locking here is optional. You can also lock cards directly on the Optimize page.</p></div><b>${this.ownedCopies()}/${MAX_SELECTED_CARDS} cards · ${this.state.inventory.cards.length} variants</b></div>
        ${this.state.inventory.cards.length ? `<div class="rv-search small"><span>⌕</span><input id="inventory-search" value="${escapeHtml(this.inventorySearch)}" placeholder="Search your inventory…"></div>` : ''}
        <div class="rv-owned-list">${owned.length ? owned.map((card) => this.renderOwnedCard(card)).join('') : `<div class="rv-empty"><strong>${this.state.inventory.cards.length ? 'No matching cards' : 'Your inventory is empty'}</strong><span>${this.state.inventory.cards.length ? 'Try a different search.' : 'Use the card list above to add your first card.'}</span></div>`}</div>
      </section>

      ${this.renderAuraManager()}
      ${this.renderTransferPanel()}
    `
  }

  private catalogBordersFor(name: string) {
    return canonicalBorders(this.catalogBorders.get(name) ?? [])
  }

  private renderCatalogCard(card: (typeof cards)[number]) {
    const borders = this.catalogBordersFor(card.name)
    const variantKey = cardVariantKey(card.name, borders)
    const owned = this.state.inventory.cards.find((item) => cardVariantKey(item.cardName, item.borders) === variantKey)
    const description = card.ability ? abilities[card.ability] : ''
    const atCardLimit = this.ownedCopies() >= MAX_SELECTED_CARDS
    return `<article class="rv-catalog-card">
      ${this.renderArt(card.name, borders)}
      <div class="rv-catalog-body">
        <div class="rv-card-title"><strong>${escapeHtml(card.name)}</strong><span>1/${formatCompact(card.rarity)}</span></div>
        <p class="rv-ability"><b>${escapeHtml(card.ability || 'No ability')}</b>${description ? `<span>${escapeHtml(description)}</span>` : ''}</p>
        <div class="rv-border-row" aria-label="Card borders">
          ${CARD_BORDERS.map((border) => `<button class="rv-border ${borders.includes(border) ? 'active' : ''}" data-action="catalog-border" data-name="${escapeHtml(card.name)}" data-border="${border}" title="${border}">${border[0]}</button>`).join('')}
        </div>
        <button class="rv-add-card ${owned ? 'owned' : ''}" data-action="catalog-add" data-name="${escapeHtml(card.name)}" ${atCardLimit ? 'disabled' : ''}>${atCardLimit ? `Inventory full · ${MAX_SELECTED_CARDS}/${MAX_SELECTED_CARDS}` : owned ? `Add another · owned ×${owned.quantity}` : '+ Add to inventory'}</button>
      </div>
    </article>`
  }

  private renderOwnedCard(card: OwnedCard) {
    const def = cardDefinition(card.cardName)
    const key = enc(cardVariantKey(card.cardName, card.borders))
    const locked = card.locked || card.lockedPosition !== null
    return `<article class="rv-owned-card ${locked ? 'locked' : ''}">
      <div class="rv-owned-main">
        ${this.renderArt(card.cardName, card.borders, true)}
        <div class="rv-owned-info"><strong>${escapeHtml(card.cardName)}</strong><span>${escapeHtml(borderLabel(card.borders))}</span><small>${escapeHtml(def?.ability || 'No ability')}</small></div>
      </div>
      <div class="rv-qty" aria-label="Quantity"><button data-action="qty-minus" data-key="${key}">−</button><b>×${card.quantity}</b><button data-action="qty-plus" data-key="${key}" ${this.ownedCopies() >= MAX_SELECTED_CARDS ? 'disabled' : ''}>+</button></div>
      <div class="rv-lock-control">
        <button class="rv-lock-btn ${locked ? 'active' : ''}" data-action="card-lock" data-key="${key}">${locked ? '✓ Locked' : 'Lock in deck'}</button>
        ${locked ? `<div class="rv-position"><span>Position</span>${['Any', '1', '2', '3', '4'].map((label, index) => {
          const value = index - 1
          const active = value === -1 ? card.lockedPosition === null : card.lockedPosition === value
          return `<button class="${active ? 'active' : ''}" data-action="card-position" data-key="${key}" data-position="${value}">${label}</button>`
        }).join('')}</div>` : ''}
        <button class="rv-remove-card" data-action="remove-card" data-key="${key}">Remove</button>
      </div>
      <details class="rv-advanced-row"><summary>Advanced</summary><div>
        <span>Borders</span><div class="rv-border-row">${CARD_BORDERS.map((border) => `<button class="rv-border ${card.borders.includes(border) ? 'active' : ''}" data-action="owned-border" data-key="${key}" data-border="${border}">${border[0]}</button>`).join('')}</div>
      </div></details>
    </article>`
  }

  private renderAuraManager() {
    const query = this.auraSearch.trim().toLowerCase()
    const availableStat = depthSelectableAuras.filter((aura) => aura.type === 'Stat' && !this.state.inventory.statAuras.some((owned) => owned.auraName === aura.name) && (!query || aura.name.toLowerCase().includes(query) || (aura.skillName || '').toLowerCase().includes(query)))
    const availableAbility = depthSelectableAuras.filter((aura) => aura.type === 'Skill' && !this.state.inventory.abilityAuras.some((owned) => owned.auraName === aura.name) && (!query || aura.name.toLowerCase().includes(query) || (aura.skillName || '').toLowerCase().includes(query)))
    return `<section class="rv-panel">
      <div class="rv-section-head"><div><h2>Auras</h2><p>Add the auras you actually own. The optimizer can choose the best one automatically.</p></div><b>${this.state.inventory.statAuras.length + this.state.inventory.abilityAuras.length} owned</b></div>
      <div class="rv-search small"><span>⌕</span><input id="aura-search" value="${escapeHtml(this.auraSearch)}" placeholder="Filter aura choices…"></div>
      <div class="rv-aura-columns">
        ${this.renderAuraColumn('stat', 'Stat Auras', this.state.inventory.statAuras, availableStat)}
        ${this.renderAuraColumn('ability', 'Ability Auras', this.state.inventory.abilityAuras, availableAbility)}
      </div>
    </section>`
  }

  private renderAuraColumn(kind: AuraKind, title: string, owned: OwnedAura[], available: typeof depthSelectableAuras) {
    const atAuraLimit = kind === 'stat' && owned.length >= MAX_STAT_AURAS
    return `<div class="rv-aura-column"><div class="rv-aura-head"><strong>${title}</strong><span>${kind === 'stat' ? `${owned.length}/${MAX_STAT_AURAS}` : owned.length} owned</span></div>
      ${owned.length ? `<div class="rv-aura-owned">${owned.map((aura) => {
        const def = auras.find((entry) => entry.name === aura.auraName)
        return `<div class="rv-aura-row"><div><strong>${escapeHtml(aura.auraName)}</strong><small>${escapeHtml(def?.skillName || '')}</small></div><select data-action="aura-border" data-kind="${kind}" data-name="${escapeHtml(aura.auraName)}">${AURA_BORDERS.map((border) => `<option value="${border}" ${aura.borders[0] === border ? 'selected' : ''}>${border}</option>`).join('')}</select><button data-action="remove-aura" data-kind="${kind}" data-name="${escapeHtml(aura.auraName)}">×</button></div>`
      }).join('')}</div>` : '<p class="rv-muted">None added yet.</p>'}
      <div class="rv-aura-add"><select id="add-${kind}-aura" ${atAuraLimit ? 'disabled' : ''}><option value="">${atAuraLimit ? `Stat Aura limit reached (${MAX_STAT_AURAS})` : 'Choose an aura…'}</option>${available.map((aura) => `<option value="${escapeHtml(aura.name)}">${escapeHtml(aura.name)}${aura.skillName ? ` · ${escapeHtml(aura.skillName)}` : ''}</option>`).join('')}</select><button data-action="add-aura" data-kind="${kind}" ${atAuraLimit ? 'disabled' : ''}>Add</button></div>
    </div>`
  }

  private renderTransferPanel() {
    return `<details class="rv-panel rv-transfer"><summary><strong>Import / Export inventory</strong><span>Backup or move your inventory to another device</span></summary><div class="rv-transfer-body"><textarea id="inventory-code" spellcheck="false" placeholder="DHINV1:…">${escapeHtml(this.inventoryCodeText)}</textarea><div class="rv-actions"><button data-action="copy-inventory">Copy current inventory</button><button data-action="load-inventory" ${this.inventoryCodeText.trim() ? '' : 'disabled'}>Load pasted code</button><button data-action="clear-inventory-code">Clear</button></div>${this.inventoryCodeStatus ? `<small>${escapeHtml(this.inventoryCodeStatus)}</small>` : ''}</div></details>`
  }

  private renderOptimize() {
    const locked = this.lockedCards()
    const inventory = [...this.state.inventory.cards].sort((a, b) => Number(b.locked) - Number(a.locked) || b.quantity - a.quantity || a.cardName.localeCompare(b.cardName))
    const lockedStat = this.state.inventory.statAuras.find((aura) => aura.locked)
    const lockedAbility = this.state.inventory.abilityAuras.find((aura) => aura.locked)
    const canSearch = this.ownedCopies() >= 4 && this.ownedCopies() <= MAX_SELECTED_CARDS && this.state.inventory.statAuras.length <= MAX_STAT_AURAS && !this.worker
    return `
      <section class="rv-hero">
        <div><span>Step 2</span><h1>Find the best deck</h1><p>Everything is automatic unless you lock something below.</p></div>
        <div class="rv-run-box">
          ${this.worker ? `<button class="rv-cancel" data-action="cancel-search">Cancel optimizer</button>` : `<button class="rv-primary big" data-action="start-full" ${canSearch ? '' : 'disabled'}>Find Best Deck</button>`}
          <small>${this.ownedCopies() < 4 ? 'Add at least 4 card copies first.' : 'One thorough search · cards, auras, order, then exact Depths validation'}</small>
        </div>
      </section>

      <section class="rv-panel rv-lock-panel">
        <div class="rv-section-head"><div><h2>Cards you want to keep <span class="rv-optional">optional</span></h2><p>Click a card to force it into every suggested deck. Pick a slot only if position matters.</p></div><div class="rv-head-actions">${locked.length ? `<button data-action="clear-locks">Clear locks</button>` : ''}<b>${locked.length}/4 locked</b></div></div>
        ${inventory.length ? `<div class="rv-lock-grid">${inventory.map((card) => this.renderOptimizerLock(card)).join('')}</div>` : `<div class="rv-empty"><strong>No cards yet</strong><span>Add cards in Inventory first.</span><button data-action="tab" data-tab="inventory">Add cards</button></div>`}
      </section>

      <section class="rv-panel rv-aura-opt">
        <div class="rv-section-head"><div><h2>Aura preference <span class="rv-optional">optional</span></h2><p>Leave on Auto unless you specifically want an aura used.</p></div></div>
        <div class="rv-aura-selects">
          ${this.renderOptimizerAuraSelect('stat', 'Stat Aura', lockedStat)}
          ${this.renderOptimizerAuraSelect('ability', 'Ability Aura', lockedAbility)}
        </div>
      </section>

      ${this.renderBans()}
      ${this.progress ? this.renderProgress() : ''}
      ${this.results.length ? this.renderResults() : `<section class="rv-results-empty"><div class="rv-result-placeholder">${this.ownedCopies() >= 4 ? '<strong>Ready when you are</strong><span>Click Find Best Deck to test your inventory.</span>' : '<strong>Inventory needs 4 cards</strong><span>Add at least four owned copies before searching.</span>'}</div></section>`}
    `
  }

  private renderOptimizerLock(card: OwnedCard) {
    const key = enc(cardVariantKey(card.cardName, card.borders))
    const locked = card.locked || card.lockedPosition !== null
    return `<article class="rv-lock-card ${locked ? 'active' : ''}">
      <button class="rv-lock-main" data-action="card-lock" data-key="${key}">${this.renderArt(card.cardName, card.borders, true)}<span><strong>${escapeHtml(card.cardName)}</strong><small>${escapeHtml(borderLabel(card.borders))} · ×${card.quantity}</small></span><b>${locked ? '✓ Keep' : '+ Keep'}</b></button>
      ${locked ? `<div class="rv-inline-position"><span>Slot</span>${['Any', '1', '2', '3', '4'].map((label, index) => { const value = index - 1; const active = value === -1 ? card.lockedPosition === null : card.lockedPosition === value; return `<button class="${active ? 'active' : ''}" data-action="card-position" data-key="${key}" data-position="${value}">${label}</button>` }).join('')}</div>` : ''}
    </article>`
  }

  private renderOptimizerAuraSelect(kind: AuraKind, label: string, locked?: OwnedAura) {
    const source = kind === 'stat' ? this.state.inventory.statAuras : this.state.inventory.abilityAuras
    return `<label><span>${label}</span><select data-action="optimizer-aura" data-kind="${kind}"><option value="">Auto — choose the best</option>${source.map((aura) => `<option value="${escapeHtml(aura.auraName)}" ${locked?.auraName === aura.auraName ? 'selected' : ''}>${escapeHtml(aura.auraName)} · ${escapeHtml(aura.borders[0] || 'Base')}</option>`).join('')}</select>${source.length ? '' : '<small>Add owned auras from Inventory to use them here.</small>'}</label>`
  }

  private renderBans() {
    const query = this.banSearch.trim().toLowerCase()
    const candidates = cards.filter(isDepthsSourceEligible).filter((card) => !this.state.depthBans.includes(card.name)).filter((card) => query && (card.name.toLowerCase().includes(query) || (card.ability || '').toLowerCase().includes(query))).sort((a, b) => a.name.localeCompare(b.name)).slice(0, 10)
    return `<details class="rv-panel rv-bans"><summary><div><strong>Advanced: Depth bans</strong><span>Only change this if you use custom bans in Depths.</span></div><b>${this.state.depthBans.length}/${MAX_DEPTH_BANS}</b></summary><div class="rv-ban-body">
      ${this.state.depthBans.length ? `<div class="rv-ban-chips">${this.state.depthBans.map((name) => `<button data-action="remove-ban" data-name="${escapeHtml(name)}">${escapeHtml(name)} ×</button>`).join('')}<button class="clear" data-action="clear-bans">Clear all</button></div>` : '<p class="rv-muted">No custom bans selected.</p>'}
      <div class="rv-ban-search"><input id="ban-search" value="${escapeHtml(this.banSearch)}" placeholder="Search an enemy to ban…" ${this.worker || this.state.depthBans.length >= MAX_DEPTH_BANS ? 'disabled' : ''}>${query && !this.worker && this.state.depthBans.length < MAX_DEPTH_BANS ? `<div class="rv-ban-suggestions">${candidates.length ? candidates.map((card) => `<button data-action="add-ban" data-name="${escapeHtml(card.name)}"><strong>${escapeHtml(card.name)}</strong><span>${escapeHtml(card.ability || 'No ability')}</span></button>`).join('') : '<small>No matching eligible enemy.</small>'}</div>` : ''}</div>
    </div></details>`
  }

  private renderProgress() {
    if (!this.progress) return ''
    const progress = this.progress
    const labels: Record<OptimizerProgress['phase'], string> = { prepare: 'Preparing', quick: 'Team combinations', middle: 'Aura synergy', order: 'Card order', final: 'Exact validation', replacement: 'Testing replacements' }
    const total = Math.max(1, progress.fullySimulatedTotal || progress.quickTested + progress.remainingCandidates)
    const done = progress.fullySimulatedTotal ? progress.fullySimulated : progress.quickTested
    const percent = Math.max(3, Math.min(100, Math.round(done / total * 100)))
    return `<section class="rv-progress"><div class="rv-progress-top"><div><strong>${labels[progress.phase]}</strong><span>${escapeHtml(progress.message || 'Working through your inventory…')}</span></div><b>${percent}%</b></div><div class="rv-progress-bar"><i style="width:${percent}%"></i></div><div class="rv-progress-stats"><span><b>${formatNumber(progress.quickTested)}</b> tested</span><span><b>${formatNumber(progress.finalists)}</b> finalists</span><span><b>${formatNumber(progress.simulations)}</b> simulations</span></div>${progress.currentBest ? `<div class="rv-current-best"><span>Current leader</span><strong>${escapeHtml(deckLabel(progress.currentBest.loadout))}</strong></div>` : ''}</section>`
  }

  private sortedResults() {
    // The optimizer already applies the reliability-aware ranking. Do not re-sort it
    // in the UI with a different formula and accidentally undo the search result.
    return this.results.slice(0, 10)
  }

  private renderResults() {
    const results = this.sortedResults()
    return `<section class="rv-results"><div class="rv-results-head"><div><span>Results</span><h2>Best usable decks for your inventory</h2></div><small>Ranked for reliable Depths performance · higher is better</small></div><div class="rv-result-list">${results.map((result, index) => this.renderResult(result, index)).join('')}</div></section>`
  }

  private renderResult(result: RankedTeam, index: number) {
    const powerEstimate = result.quickEstimate ?? result.metrics.medianDepth
    return `<article class="rv-result-card ${index === 0 ? 'winner' : ''}">
      <div class="rv-result-rank"><b>#${index + 1}</b>${index === 0 ? '<span>Best match</span>' : ''}</div>
      <div class="rv-result-team">${result.loadout.cards.map((card, slot) => `<div class="rv-result-slot">${this.renderArt(card.cardName, card.borders, true)}<div><span>Slot ${slot + 1}</span><strong>${escapeHtml(card.cardName)}</strong><small>${escapeHtml(borderLabel(card.borders))}</small></div></div>`).join('')}</div>
      <div class="rv-result-meta"><span>Stat Aura <b>${escapeHtml(auraLabel(result.loadout.statAura))}</b></span><span>Ability Aura <b>${escapeHtml(auraLabel(result.loadout.abilityAura))}</b></span><span>Power estimate <b>~${formatNumber(powerEstimate)}</b></span><span>Reliable Depth <b>${formatNumber(result.metrics.reliabilityDepth ?? result.metrics.minimumDepth)}</b></span><span>Median Depth <b>${formatNumber(result.metrics.medianDepth)}</b></span><span>Average <b>${formatNumber(result.metrics.averageDepth, 1)}</b></span></div>
      ${result.metrics.trusted ? '' : `<div class="rv-warning">Some mechanics are not fully verified: ${escapeHtml(result.metrics.unsupportedAbilities.join(', '))}</div>`}
      <div class="rv-result-actions"><button class="rv-primary" data-action="copy-result" data-id="${escapeHtml(result.id)}">Copy Depths Code</button><button data-action="use-result" data-id="${escapeHtml(result.id)}">Use Deck</button><button data-action="save-result" data-id="${escapeHtml(result.id)}">Save</button></div>
    </article>`
  }

  private renderSaved() {
    const current = this.state.currentDeck
    return `<section class="rv-page-title"><div><span>Your decks</span><h1>Saved decks</h1><p>Save a recommendation, copy it to Depths, or lock it back into the optimizer.</p></div></section>
      ${current.cards.length === 4 ? `<section class="rv-panel rv-current-deck"><div class="rv-section-head"><div><h2>Current deck</h2><p>The last deck you chose from your results.</p></div><div class="rv-actions"><button data-action="copy-current">Copy Depths Code</button><button data-action="save-current">Save current</button></div></div>${this.renderLoadout(current)}</section>` : ''}
      <section class="rv-panel"><div class="rv-section-head"><div><h2>Saved</h2><p>${this.state.favorites.length ? 'Your saved setups stay on this device.' : 'Save a result and it will appear here.'}</p></div><b>${this.state.favorites.length}</b></div>${this.state.favorites.length ? `<div class="rv-saved-list">${this.state.favorites.map((favorite) => `<article class="rv-saved-card"><div class="rv-saved-title"><strong>${escapeHtml(favorite.name)}</strong><span>${new Date(favorite.createdAt).toLocaleDateString()}</span></div>${this.renderLoadout(favorite.loadout)}<div class="rv-result-actions"><button class="rv-primary" data-action="favorite-lock" data-id="${escapeHtml(favorite.id)}">Optimize around this</button><button data-action="favorite-copy" data-id="${escapeHtml(favorite.id)}">Copy code</button><button data-action="favorite-load" data-id="${escapeHtml(favorite.id)}">Use</button><button class="danger" data-action="favorite-delete" data-id="${escapeHtml(favorite.id)}">Delete</button></div></article>`).join('')}</div>` : '<div class="rv-empty"><strong>No saved decks yet</strong><span>Run the optimizer, then click Save on a result.</span><button data-action="tab" data-tab="optimize">Go to Optimize</button></div>'}</section>`
  }

  private renderLoadout(loadout: TeamLoadout) {
    return `<div class="rv-loadout"><div class="rv-loadout-cards">${loadout.cards.map((card, index) => `<div>${this.renderArt(card.cardName, card.borders, true)}<span>${index + 1}</span><strong>${escapeHtml(card.cardName)}</strong><small>${escapeHtml(borderLabel(card.borders))}</small></div>`).join('')}</div><div class="rv-loadout-auras"><span>Stat <b>${escapeHtml(auraLabel(loadout.statAura))}</b></span><span>Ability <b>${escapeHtml(auraLabel(loadout.abilityAura))}</b></span></div></div>`
  }

  private onInput(event: Event) {
    const target = event.target
    if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) return
    if (target.id === 'catalog-search') { this.catalogSearch = target.value; this.renderAndRefocus('catalog-search') }
    else if (target.id === 'inventory-search') { this.inventorySearch = target.value; this.renderAndRefocus('inventory-search') }
    else if (target.id === 'aura-search') { this.auraSearch = target.value; this.renderAndRefocus('aura-search') }
    else if (target.id === 'ban-search') { this.banSearch = target.value; this.renderAndRefocus('ban-search') }
    else if (target.id === 'inventory-code') { this.inventoryCodeText = target.value; this.inventoryCodeStatus = '' }
  }

  private onChange(event: Event) {
    const target = event.target
    if (!(target instanceof HTMLSelectElement)) return
    const action = target.dataset.action
    if (action === 'aura-border') this.setAuraBorder(target.dataset.kind as AuraKind, target.dataset.name || '', target.value as AuraOwnedBorder)
    else if (action === 'optimizer-aura') this.setOptimizerAura(target.dataset.kind as AuraKind, target.value)
  }

  private onClick(event: Event) {
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-action]') : null
    if (!target) return
    const action = target.dataset.action
    if (action === 'tab') { this.tab = target.dataset.tab as Tab; this.render(); return }
    if (action === 'clear-error') { this.error = ''; this.render(); return }
    if (action === 'catalog-border') this.toggleCatalogBorder(target.dataset.name || '', target.dataset.border as BorderName)
    else if (action === 'catalog-add') this.addCard(target.dataset.name || '', this.catalogBordersFor(target.dataset.name || ''))
    else if (action === 'qty-minus') this.changeQuantity(target.dataset.key || '', -1)
    else if (action === 'qty-plus') this.changeQuantity(target.dataset.key || '', 1)
    else if (action === 'card-lock') this.toggleLock(target.dataset.key || '')
    else if (action === 'card-position') this.setPosition(target.dataset.key || '', Number(target.dataset.position))
    else if (action === 'owned-border') this.toggleOwnedBorder(target.dataset.key || '', target.dataset.border as BorderName)
    else if (action === 'remove-card') this.removeCard(target.dataset.key || '')
    else if (action === 'clear-locks') this.clearLocks()
    else if (action === 'add-aura') this.addAura(target.dataset.kind as AuraKind)
    else if (action === 'remove-aura') this.removeAura(target.dataset.kind as AuraKind, target.dataset.name || '')
    else if (action === 'add-ban') this.addBan(target.dataset.name || '')
    else if (action === 'remove-ban') this.removeBan(target.dataset.name || '')
    else if (action === 'clear-bans') this.clearBans()
    else if (action === 'start-full') this.startSearch('full')
    else if (action === 'cancel-search') this.cancelWorker()
    else if (action === 'copy-result') void this.copyResult(target.dataset.id || '', target)
    else if (action === 'use-result') this.useResult(target.dataset.id || '')
    else if (action === 'save-result') this.saveResult(target.dataset.id || '')
    else if (action === 'copy-current') void this.copyLoadout(this.state.currentDeck, target)
    else if (action === 'save-current') this.saveCurrent()
    else if (action === 'favorite-lock') this.lockFavorite(target.dataset.id || '')
    else if (action === 'favorite-copy') void this.copyFavorite(target.dataset.id || '', target)
    else if (action === 'favorite-load') this.loadFavorite(target.dataset.id || '')
    else if (action === 'favorite-delete') this.deleteFavorite(target.dataset.id || '')
    else if (action === 'copy-inventory') void this.copyInventory()
    else if (action === 'load-inventory') this.loadInventory()
    else if (action === 'clear-inventory-code') { this.inventoryCodeText = ''; this.inventoryCodeStatus = ''; this.render() }
  }

  private renderAndRefocus(id: string) {
    const input = document.getElementById(id) as HTMLInputElement | null
    const position = input?.selectionStart ?? input?.value.length ?? 0
    this.render()
    const next = document.getElementById(id) as HTMLInputElement | null
    if (id === 'ban-search') {
      const details = next?.closest('details') as HTMLDetailsElement | null
      if (details) details.open = true
    }
    if (next) { next.focus(); next.setSelectionRange(position, position) }
  }

  private toggleCatalogBorder(name: string, border: BorderName) {
    if (!CARD_BORDERS.includes(border)) return
    const current = this.catalogBordersFor(name)
    this.catalogBorders.set(name, canonicalBorders(current.includes(border) ? current.filter((value) => value !== border) : [...current, border]))
    this.render()
  }

  private findOwned(encodedKey: string) {
    const key = dec(encodedKey)
    return this.state.inventory.cards.find((card) => cardVariantKey(card.cardName, card.borders) === key)
  }

  private addCard(name: string, borders: BorderName[]) {
    const definition = cardDefinition(name)
    if (!definition || (definition.unobtainable && definition.name !== 'Conqueror')) return
    if (this.ownedCopies() >= MAX_SELECTED_CARDS) {
      this.error = `You can select up to ${MAX_SELECTED_CARDS} total card copies.`
      this.render()
      return
    }
    const normalized = canonicalBorders(borders)
    const key = cardVariantKey(name, normalized)
    const existing = this.state.inventory.cards.find((card) => cardVariantKey(card.cardName, card.borders) === key)
    if (existing) existing.quantity = Math.min(999, existing.quantity + 1)
    else this.state.inventory.cards.push({ cardName: name, quantity: 1, borders: normalized, locked: false, lockedPosition: null })
    this.error = ''
    this.persist()
    this.render()
  }

  private changeQuantity(encodedKey: string, delta: number) {
    const card = this.findOwned(encodedKey)
    if (!card) return
    if (delta > 0 && this.ownedCopies() >= MAX_SELECTED_CARDS) {
      this.error = `You can select up to ${MAX_SELECTED_CARDS} total card copies.`
      this.render()
      return
    }
    if (delta < 0 && card.quantity <= 1) {
      this.removeCard(encodedKey)
      return
    }
    card.quantity = Math.max(1, Math.min(999, card.quantity + delta))
    this.persist(); this.render()
  }

  private toggleLock(encodedKey: string) {
    const card = this.findOwned(encodedKey)
    if (!card) return
    const locked = card.locked || card.lockedPosition !== null
    if (!locked && this.lockedCards().length >= 4) {
      this.error = 'You can lock up to 4 card variants. Unlock one first.'
      this.render()
      return
    }
    card.locked = !locked
    card.lockedPosition = null
    this.error = ''
    this.persist(); this.render()
  }

  private setPosition(encodedKey: string, value: number) {
    const card = this.findOwned(encodedKey)
    if (!card) return
    if (!card.locked && card.lockedPosition === null && this.lockedCards().length >= 4) return
    card.locked = true
    card.lockedPosition = value >= 0 && value <= 3 ? value as DeckSlot : null
    for (const other of this.state.inventory.cards) {
      if (other !== card && card.lockedPosition !== null && other.lockedPosition === card.lockedPosition) other.lockedPosition = null
    }
    this.persist(); this.render()
  }

  private toggleOwnedBorder(encodedKey: string, border: BorderName) {
    const card = this.findOwned(encodedKey)
    if (!card || !CARD_BORDERS.includes(border)) return
    const oldKey = cardVariantKey(card.cardName, card.borders)
    const nextBorders = canonicalBorders(card.borders.includes(border) ? card.borders.filter((value) => value !== border) : [...card.borders, border])
    const nextKey = cardVariantKey(card.cardName, nextBorders)
    const duplicate = this.state.inventory.cards.find((item) => item !== card && cardVariantKey(item.cardName, item.borders) === nextKey)
    if (duplicate) {
      duplicate.quantity = Math.min(999, duplicate.quantity + card.quantity)
      duplicate.locked = duplicate.locked || card.locked
      duplicate.lockedPosition = duplicate.lockedPosition ?? card.lockedPosition
      this.state.inventory.cards = this.state.inventory.cards.filter((item) => item !== card)
    } else card.borders = nextBorders
    this.state.currentDeck.cards = this.state.currentDeck.cards.map((slot) => teamCardVariantKey(slot) === oldKey ? { cardName: card.cardName, borders: nextBorders } : slot)
    this.persist(); this.render()
  }

  private removeCard(encodedKey: string) {
    const key = dec(encodedKey)
    this.state.inventory.cards = this.state.inventory.cards.filter((card) => cardVariantKey(card.cardName, card.borders) !== key)
    this.state.currentDeck.cards = this.state.currentDeck.cards.filter((card) => teamCardVariantKey(card) !== key)
    this.results = []
    this.persist(); this.render()
  }

  private clearLocks() {
    for (const card of this.state.inventory.cards) { card.locked = false; card.lockedPosition = null }
    this.persist(); this.render()
  }

  private auraList(kind: AuraKind) {
    return kind === 'stat' ? this.state.inventory.statAuras : this.state.inventory.abilityAuras
  }

  private addAura(kind: AuraKind) {
    const select = document.getElementById(`add-${kind}-aura`) as HTMLSelectElement | null
    const name = select?.value || ''
    if (!name || this.auraList(kind).some((aura) => aura.auraName === name)) return
    if (kind === 'stat' && this.state.inventory.statAuras.length >= MAX_STAT_AURAS) {
      this.error = `You can test up to ${MAX_STAT_AURAS} Stat Auras at a time.`
      this.render()
      return
    }
    this.auraList(kind).push({ auraName: name, borders: ['Base'], locked: false })
    this.persist(); this.render()
  }

  private removeAura(kind: AuraKind, name: string) {
    if (kind === 'stat') this.state.inventory.statAuras = this.state.inventory.statAuras.filter((aura) => aura.auraName !== name)
    else this.state.inventory.abilityAuras = this.state.inventory.abilityAuras.filter((aura) => aura.auraName !== name)
    this.persist(); this.render()
  }

  private setAuraBorder(kind: AuraKind, name: string, border: AuraOwnedBorder) {
    if (!AURA_BORDERS.includes(border)) return
    const aura = this.auraList(kind).find((item) => item.auraName === name)
    if (!aura) return
    aura.borders = [border]
    this.persist(); this.render()
  }

  private setOptimizerAura(kind: AuraKind, name: string) {
    const list = this.auraList(kind)
    for (const aura of list) aura.locked = Boolean(name && aura.auraName === name)
    this.persist(); this.render()
  }

  private addBan(name: string) {
    if (this.worker || this.state.depthBans.length >= MAX_DEPTH_BANS || this.state.depthBans.includes(name)) return
    const card = cardDefinition(name)
    if (!card || !isDepthsSourceEligible(card)) return
    this.state.depthBans.push(name)
    this.banSearch = ''
    this.results = []
    this.persist(); this.render()
  }

  private removeBan(name: string) {
    if (this.worker) return
    this.state.depthBans = this.state.depthBans.filter((item) => item !== name)
    this.results = []
    this.persist(); this.render()
  }

  private clearBans() {
    if (this.worker) return
    this.state.depthBans = []
    this.banSearch = ''
    this.results = []
    this.persist(); this.render()
  }

  private startSearch(mode: 'fast' | 'full') {
    if (this.ownedCopies() < 4) {
      this.error = 'Add at least 4 card copies before optimizing.'
      this.tab = 'inventory'
      this.render()
      return
    }
    if (this.ownedCopies() > MAX_SELECTED_CARDS) {
      this.error = `Reduce your selected inventory to ${MAX_SELECTED_CARDS} card copies or fewer.`
      this.tab = 'inventory'
      this.render()
      return
    }
    if (this.state.inventory.statAuras.length > MAX_STAT_AURAS) {
      this.error = `Choose no more than ${MAX_STAT_AURAS} Stat Auras to test.`
      this.tab = 'inventory'
      this.render()
      return
    }
    this.error = ''
    this.results = []
    this.progress = null
    this.searchMode = mode
    this.runWorker({ kind: 'search', inventory: structuredClone(this.state.inventory), bannedCardNames: [...this.state.depthBans], settings: { mode } })
  }

  private runWorker(request: OptimizerRequest) {
    this.cancelWorker(false)
    this.worker = new Worker(new URL('./optimizer-worker.ts', import.meta.url), { type: 'module' })
    this.worker.onmessage = (event: MessageEvent<WorkerOutbound>) => {
      const message = event.data
      if (message.type === 'progress') {
        this.progress = message.progress
        if (this.tab === 'optimize') {
          const current = this.root.querySelector<HTMLElement>('.rv-progress')
          const html = this.renderProgress()
          if (current && html) current.outerHTML = html
          else if (!current) this.render()
        }
        return
      }
      if (message.type === 'search-result') { this.results = message.results; this.progress = null; this.finishWorker() }
      else if (message.type === 'error') { this.error = message.message; this.progress = null; this.finishWorker() }
      this.render()
    }
    this.worker.onerror = (event) => { this.error = event.message || 'Optimizer worker failed.'; this.progress = null; this.finishWorker(); this.render() }
    this.worker.postMessage({ type: 'run', request })
    this.render()
  }

  private cancelWorker(render = true) {
    this.worker?.terminate()
    this.worker = null
    this.progress = null
    if (render) this.render()
  }

  private finishWorker() {
    this.worker?.terminate()
    this.worker = null
  }

  private resultById(id: string) {
    return this.results.find((result) => result.id === id)
  }

  private async writeClipboard(text: string, button?: HTMLElement) {
    try {
      await navigator.clipboard.writeText(text)
      if (button) {
        const original = button.textContent || 'Copy'
        button.textContent = 'Copied!'
        window.setTimeout(() => { if (button.isConnected) button.textContent = original }, 1400)
      }
      return true
    } catch {
      const textarea = document.createElement('textarea')
      textarea.value = text
      textarea.style.position = 'fixed'
      textarea.style.opacity = '0'
      document.body.appendChild(textarea)
      textarea.select()
      const ok = document.execCommand('copy')
      textarea.remove()
      return ok
    }
  }

  private async copyLoadout(loadout: TeamLoadout, button?: HTMLElement) {
    try {
      const code = encodeDepthsTeam(loadout)
      const copied = await this.writeClipboard(code, button)
      if (!copied) window.prompt('Copy this Depths code:', code)
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Could not create Depths code.'
      this.render()
    }
  }

  private async copyResult(id: string, button?: HTMLElement) {
    const result = this.resultById(id)
    if (result) await this.copyLoadout(result.loadout, button)
  }

  private useResult(id: string) {
    const result = this.resultById(id)
    if (!result) return
    this.state.currentDeck = structuredClone(result.loadout)
    this.persist(); this.tab = 'saved'; this.render()
  }

  private saveResult(id: string) {
    const result = this.resultById(id)
    if (!result) return
    this.state.favorites.unshift(makeFavorite(deckLabel(result.loadout), result.loadout))
    this.persist(); this.render()
  }

  private saveCurrent() {
    if (this.state.currentDeck.cards.length !== 4) return
    this.state.favorites.unshift(makeFavorite(deckLabel(this.state.currentDeck), this.state.currentDeck))
    this.persist(); this.render()
  }

  private favorite(id: string) {
    return this.state.favorites.find((favorite) => favorite.id === id)
  }

  private async copyFavorite(id: string, button?: HTMLElement) {
    const favorite = this.favorite(id)
    if (favorite) await this.copyLoadout(favorite.loadout, button)
  }

  private loadFavorite(id: string) {
    const favorite = this.favorite(id)
    if (!favorite) return
    this.state.currentDeck = structuredClone(favorite.loadout)
    this.persist(); this.render()
  }

  private deleteFavorite(id: string) {
    this.state.favorites = this.state.favorites.filter((favorite) => favorite.id !== id)
    this.persist(); this.render()
  }

  private lockFavorite(id: string) {
    const favorite = this.favorite(id)
    if (!favorite) return
    for (const card of this.state.inventory.cards) { card.locked = false; card.lockedPosition = null }
    for (const [slot, selected] of favorite.loadout.cards.entries()) {
      const owned = this.state.inventory.cards.find((card) => teamCardVariantKey(selected) === cardVariantKey(card.cardName, card.borders))
      if (owned) { owned.locked = true; owned.lockedPosition = slot as DeckSlot }
    }
    for (const aura of this.state.inventory.statAuras) aura.locked = aura.auraName === favorite.loadout.statAura?.auraName
    for (const aura of this.state.inventory.abilityAuras) aura.locked = aura.auraName === favorite.loadout.abilityAura?.auraName
    this.persist(); this.tab = 'optimize'; this.render()
  }

  private async copyInventory() {
    const code = exportInventoryCode(this.state.inventory)
    this.inventoryCodeText = code
    const ok = await this.writeClipboard(code)
    this.inventoryCodeStatus = ok ? 'Copied to clipboard.' : 'Code generated below.'
    this.render()
  }

  private loadInventory() {
    try {
      const imported = importInventoryCode(this.inventoryCodeText)
      const importedCopies = imported.cards.reduce((sum, card) => sum + card.quantity, 0)
      if (importedCopies > MAX_SELECTED_CARDS) throw new Error(`Inventory codes can contain at most ${MAX_SELECTED_CARDS} total card copies.`)
      if (imported.statAuras.length > MAX_STAT_AURAS) throw new Error(`Inventory codes can contain at most ${MAX_STAT_AURAS} Stat Auras.`)
      this.state.inventory = imported
      this.results = []
      this.error = ''
      this.inventoryCodeStatus = `Loaded ${this.ownedCopies()} card copies.`
      this.persist(); this.render()
    } catch (error) {
      this.inventoryCodeStatus = error instanceof Error ? error.message : 'Could not load that code.'
      this.render()
    }
  }
}
