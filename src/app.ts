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
import { borderKey, cardVariantKey, canonicalBorders, firstUnusedBorderVariant, teamCardVariantKey } from './card-variants'

const CARD_BORDERS: BorderName[] = ['Platinum', 'Crystal', 'Ruby', 'Galaxy']
const AURA_BORDERS: AuraOwnedBorder[] = ['Base', 'Platinum', 'Crystal', 'Galaxy']

type Tab = 'pool' | 'optimize' | 'decks'
type Ranking = 'average' | 'median' | 'minimum' | 'maximum' | 'consistency'

export class DeckHelperApp {
  private state: AppState = loadState()
  private tab: Tab = 'pool'
  private ranking: Ranking = 'average'
  private cardSearch = ''
  private addCardName = ''
  private auraSearch = ''
  private worker: Worker | null = null
  private progress: OptimizerProgress | null = null
  private results: RankedTeam[] = []
  private replacementResults: ReplacementResult[] = []
  private replacementBaseline: TeamMetrics | null = null
  private replacementSlot: DeckSlot | null = null
  private error = ''

  constructor(private root: HTMLElement) {
    this.syncPool()
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
    this.syncPool()
    this.syncCurrentDeck()
    saveState(this.state)
  }

  private syncPool() {
    const owned = new Map(this.state.inventory.cards.map((card) => [cardVariantKey(card.cardName, card.borders), card] as const))
    const used = new Map<string, number>()
    this.state.pool = (this.state.pool ?? []).flatMap((card) => {
      const key = teamCardVariantKey(card)
      const source = owned.get(key)
      const count = used.get(key) ?? 0
      if (!source || count >= source.quantity) return []
      used.set(key, count + 1)
      return [{ cardName: source.cardName, borders: canonicalBorders(source.borders) }]
    })
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
    this.syncPool()
    this.syncCurrentDeck()
    const workspace = this.tab === 'pool' ? this.renderPool() : this.tab === 'optimize' ? this.renderOptimize() : this.renderDecks()
    this.root.innerHTML = `
      <div class="app-shell">
        <header class="topbar">
          <div>
            <div class="eyebrow">Card Fantasy RNG</div>
            <h1>DeckHelper</h1>
          </div>
          <div class="top-stats">
            <span><b>${this.state.inventory.cards.reduce((sum, card) => sum + card.quantity, 0)}</b> owned copies</span>
            <span><b>${this.state.pool.length}</b> in pool</span>
            <span><b>${this.state.favorites.length}</b> saved decks</span>
          </div>
        </header>
        ${this.error ? `<div class="error-banner">${escapeHtml(this.error)}<button data-action="clear-error">×</button></div>` : ''}
        <main class="workspace-layout">
          <section class="workspace-left">
            <nav class="workspace-tabs">
              ${this.tabButton('pool', 'Pool')}
              ${this.tabButton('optimize', 'Optimize')}
              ${this.tabButton('decks', 'Saved Decks')}
            </nav>
            <div class="workspace-content">${workspace}</div>
          </section>
          <aside class="inventory-side">${this.renderInventory()}</aside>
        </main>
      </div>
    `
  }

  private tabButton(tab: Tab, label: string) {
    const count = tab === 'pool' ? this.state.pool.length : tab === 'decks' ? this.state.favorites.length : this.results.length
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
    const auraQuery = this.auraSearch.trim().toLowerCase()
    const filteredAuras = auras.filter((aura) => !auraQuery || aura.name.toLowerCase().includes(auraQuery) || (aura.skillName || '').toLowerCase().includes(auraQuery))
    return `
      <div class="inventory-side-head">
        <div><span class="eyebrow">Drag source</span><h2>Your Inventory</h2></div>
        <p>Each exact border combination is its own draggable card. Drag the same variant again when you own multiple copies.</p>
      </div>
      <section class="inventory-add panel-soft">
        <label><span>Add card or another variant</span><div class="add-card-row"><input id="add-card-name" list="card-catalog" value="${escapeHtml(this.addCardName)}" placeholder="Type a card name"><button class="primary" data-action="add-selected-card">Add</button></div></label>
        <datalist id="card-catalog">${cards.map((card) => `<option value="${escapeHtml(card.name)}"></option>`).join('')}</datalist>
      </section>
      <label class="inventory-search"><span>Search inventory</span><input id="card-search" value="${escapeHtml(this.cardSearch)}" placeholder="Name, ability, or border"></label>
      <div class="inventory-variant-list">
        ${variants.length ? variants.map((owned) => this.renderInventoryCard(owned)).join('') : `<div class="inventory-empty">${this.state.inventory.cards.length ? 'No variants match this search.' : 'Add your first card above.'}</div>`}
      </div>
      <details class="aura-drawer">
        <summary>Auras <b>${this.state.inventory.statAuras.length + this.state.inventory.abilityAuras.length}</b></summary>
        <div class="aura-drawer-body">
          <label class="inventory-search"><span>Search auras</span><input id="aura-search" value="${escapeHtml(this.auraSearch)}" placeholder="Aura name or skill"></label>
          <div class="aura-columns">
            <div><h3>Stat</h3>${filteredAuras.filter((aura) => aura.type === 'Stat').map((aura) => this.renderInventoryAura(aura.name, 'stat')).join('')}</div>
            <div><h3>Ability</h3>${filteredAuras.filter((aura) => aura.type === 'Skill').map((aura) => this.renderInventoryAura(aura.name, 'ability')).join('')}</div>
          </div>
        </div>
      </details>
    `
  }

  private renderInventoryCard(owned: OwnedCard) {
    const definition = cards.find((card) => card.name === owned.cardName)
    const encodedKey = encodeURIComponent(cardVariantKey(owned.cardName, owned.borders))
    const poolCount = this.state.pool.filter((card) => teamCardVariantKey(card) === cardVariantKey(owned.cardName, owned.borders)).length
    return `
      <article class="owned-variant-card" draggable="true" data-drag-card="${escapeHtml(encodedKey)}" data-drag-origin="inventory">
        <div class="owned-card-top">
          ${this.renderCardVisual(owned.cardName, owned.borders)}
          <div class="owned-card-info">
            <strong>${escapeHtml(owned.cardName)}</strong>
            <span>${escapeHtml(borderLabel(owned.borders))}</span>
            <small>${escapeHtml(definition?.ability || 'No ability')}</small>
            <div class="copy-line"><b>×${owned.quantity}</b><span>${poolCount ? `${poolCount} in pool` : 'drag to pool'}</span></div>
          </div>
          <button class="pool-arrow" data-action="pool-add" data-key="${escapeHtml(encodedKey)}" title="Add one copy to Pool">←</button>
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
          <button class="subtle" data-action="add-card" data-name="${escapeHtml(owned.cardName)}">+ Variant</button>
          <button class="danger subtle" data-action="remove-card" data-key="${escapeHtml(encodedKey)}">Remove</button>
        </div>
      </article>
    `
  }

  private renderPool() {
    const deck = this.state.currentDeck
    return `
      <section class="page-head split">
        <div><span class="eyebrow">Candidate workspace</span><h2>Pool</h2><p>Drag exact card variants from your inventory into this pool. Each drag adds one owned copy; the optimizer only searches cards placed here.</p></div>
        <button data-action="pool-clear" ${this.state.pool.length ? '' : 'disabled'}>Clear Pool</button>
      </section>
      <section class="pool-drop panel" data-drop-zone="pool">
        <div class="drop-zone-label"><strong>${this.state.pool.length} copies in pool</strong><span>Drop inventory cards anywhere in this box</span></div>
        ${this.state.pool.length ? `<div class="pool-grid">${this.state.pool.map((card, index) => {
          const key = cardVariantKey(card.cardName, card.borders)
          const owned = this.state.inventory.cards.find((entry) => cardVariantKey(entry.cardName, entry.borders) === key)
          const copyNumber = this.state.pool.slice(0, index + 1).filter((entry) => teamCardVariantKey(entry) === key).length
          return `<article class="pool-card" draggable="true" data-drag-card="${escapeHtml(encodeURIComponent(key))}" data-drag-origin="pool">
            ${this.renderCardVisual(card.cardName, card.borders)}
            <strong>${escapeHtml(card.cardName)}</strong>
            <span>${escapeHtml(borderLabel(card.borders))}</span>
            <small>Copy ${copyNumber}${owned ? ` / ${owned.quantity}` : ''}</small>
            <button class="pool-remove" data-action="pool-remove" data-index="${index}" title="Remove this copy">×</button>
          </article>`
        }).join('')}</div>` : `<div class="pool-empty"><b>Drop cards here</b><span>Use the inventory on the right. You can also press the ← button on a card.</span></div>`}
      </section>
      <section class="panel current-deck drag-deck">
        <div class="section-title"><div><span class="eyebrow">Manual deck</span><h3>Current 4-card deck</h3></div><span>Drag a card directly into the next open slot.</span></div>
        <div class="deck-editor">${[0, 1, 2, 3].map((slot) => this.renderDeckSlot(slot as DeckSlot)).join('')}</div>
        <div class="deck-aura-row">
          <label><span>Stat Aura</span>${this.renderAuraSelect('stat', deck.statAura)}</label>
          <label><span>Ability Aura</span>${this.renderAuraSelect('ability', deck.abilityAura)}</label>
        </div>
      </section>
      <section class="pool-help panel-soft"><b>How copies work</b><span>Platinum+Crystal Heaven's Armor and Galaxy Heaven's Armor are separate draggable variants. If either variant has Qty 2, you can drag that exact variant twice.</span></section>
    `
  }

  private poolInventory() {
    const counts = new Map<string, number>()
    for (const card of this.state.pool) {
      const key = teamCardVariantKey(card)
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    return {
      ...this.state.inventory,
      cards: this.state.inventory.cards.flatMap((card) => {
        const quantity = counts.get(cardVariantKey(card.cardName, card.borders)) ?? 0
        return quantity ? [{ ...card, borders: canonicalBorders(card.borders), quantity }] : []
      }),
    }
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
    const searchInventory = this.poolInventory()
    const lockedCards = searchInventory.cards.filter((card) => card.locked || card.lockedPosition !== null)
    const lockedStat = searchInventory.statAuras.find((aura) => aura.locked)
    const lockedAbility = searchInventory.abilityAuras.find((aura) => aura.locked)
    const sorted = this.sortedResults()
    return `
      <section class="page-head split">
        <div><span class="eyebrow">Battle simulator search</span><h2>Optimize</h2><p>Only the exact copies in your Pool are considered. Drag more variants in or remove copies to control the search space.</p></div>
        <div class="actions">${this.worker ? `<button class="danger" data-action="cancel-search">Cancel Search</button>` : `<button class="primary" data-action="start-search" ${this.state.pool.length < 4 ? 'disabled' : ''}>Find Best 4-Card Teams</button>`}</div>
      </section>
      <section class="optimizer-pool-preview panel-soft">
        <div><strong>Pool</strong><span>${this.state.pool.length} copies · ${searchInventory.cards.length} exact variants</span></div>
        <div class="mini-card-row">${this.state.pool.slice(0, 12).map((card) => this.renderCardVisual(card.cardName, card.borders, true)).join('')}${this.state.pool.length > 12 ? `<b>+${this.state.pool.length - 12}</b>` : ''}</div>
      </section>
      <section class="lock-summary panel">
        <div><span>Locked cards</span><strong>${lockedCards.length ? lockedCards.map((card) => `${escapeHtml(card.cardName)} · ${escapeHtml(borderLabel(card.borders))}${card.lockedPosition !== null ? ` (#${card.lockedPosition + 1})` : ''}`).join(', ') : 'None'}</strong></div>
        <div><span>Stat Aura</span><strong>${lockedStat ? escapeHtml(lockedStat.auraName) : 'Auto'}</strong></div>
        <div><span>Ability Aura</span><strong>${lockedAbility ? escapeHtml(lockedAbility.auraName) : 'Auto'}</strong></div>
      </section>
      ${this.progress ? this.renderProgress(this.progress) : ''}
      ${this.results.length ? `
        <section class="results-head"><h3>Top Teams</h3><div class="ranking-tabs">${this.rankingButton('average', 'Average')}${this.rankingButton('median', 'Median')}${this.rankingButton('minimum', 'Safest')}${this.rankingButton('maximum', 'Ceiling')}${this.rankingButton('consistency', 'Consistent')}</div></section>
        <section class="result-list">${sorted.map((result, index) => this.renderResult(result, index + 1)).join('')}</section>
      ` : `<section class="empty-state panel"><strong>${this.state.pool.length < 4 ? 'Your Pool needs at least 4 copies.' : 'No optimizer results yet.'}</strong><span>${this.state.pool.length < 4 ? 'Drag cards from the inventory on the right into Pool.' : 'Start the search when you are ready.'}</span></section>`}
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
          <div class="team-slots">${result.loadout.cards.map((card, index) => `<div class="team-slot">${this.renderCardVisual(card.cardName, card.borders, true)}<div><span>Slot ${index + 1}</span><strong>${escapeHtml(card.cardName)}</strong><small>${escapeHtml(borderLabel(card.borders))}</small></div></div>`).join('')}</div>
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
      <section class="page-head"><div><span class="eyebrow">Favorites</span><h2>Saved Decks</h2><p>Save the current deck from your Pool workspace or reload a favorite exactly as it was saved.</p></div></section>
      <section class="panel current-deck saved-current">
        <div class="section-title"><div><h3>Current Deck</h3><span>${complete ? 'Ready to save' : `${deck.cards.length}/4 cards`}</span></div></div>
        <div class="saved-team-preview">${[0, 1, 2, 3].map((slot) => {
          const card = deck.cards[slot]
          return card ? `<div>${this.renderCardVisual(card.cardName, card.borders)}<strong>${escapeHtml(card.cardName)}</strong><span>${escapeHtml(borderLabel(card.borders))}</span></div>` : `<div class="saved-empty-slot"><b>${slot + 1}</b><span>Empty</span></div>`
        }).join('')}</div>
        <div class="aura-line"><span>Stat: <b>${escapeHtml(auraLabel(deck.statAura))}</b></span><span>Ability: <b>${escapeHtml(auraLabel(deck.abilityAura))}</b></span></div>
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
        ${current ? `${this.renderCardVisual(current.cardName, current.borders)}<strong>${escapeHtml(current.cardName)}</strong><span>${escapeHtml(borderLabel(current.borders))}<button class="slot-clear" data-action="deck-clear" data-slot="${slot}" title="Clear slot">×</button></span><button class="replacement-button" data-action="replacement" data-slot="${slot}" ${this.state.currentDeck.cards.length === 4 && !this.worker ? '' : 'disabled'}>Best replacement</button>` : `<div class="slot-placeholder"><b>${isNextSlot ? 'Drop card here' : 'Fill earlier slots first'}</b><span>${isNextSlot ? 'Inventory or Pool card' : ''}</span></div>`}
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
    } else if (target.id === 'add-card-name') {
      this.addCardName = target.value
    }
  }

  private onChange(event: Event) {
    const target = event.target
    if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) return
    const action = target.dataset.action
    if (action === 'card-border' && target instanceof HTMLInputElement) this.toggleCardBorder(target.dataset.key || '', target.dataset.border as BorderName, target.checked)
    if (action === 'card-quantity' && target instanceof HTMLInputElement) this.setCardQuantity(target.dataset.key || '', target.value)
    if (action === 'card-lock' && target instanceof HTMLInputElement) this.toggleCardLock(target.dataset.key || '', target.checked)
    if (action === 'card-position' && target instanceof HTMLSelectElement) this.setCardPosition(target.dataset.key || '', target.value)
    if (action === 'aura-border' && target instanceof HTMLInputElement) this.toggleAuraBorder(target.dataset.kind as 'stat' | 'ability', target.dataset.name || '', target.dataset.border as AuraOwnedBorder, target.checked)
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
    } else if (action === 'add-selected-card') {
      const match = cards.find((card) => card.name.toLowerCase() === this.addCardName.trim().toLowerCase())
      if (!match) { this.error = 'Choose an exact card name from the list.'; this.render(); return }
      this.addCardName = ''
      this.addCard(match.name)
    } else if (action === 'add-card') this.addCard(target.dataset.name || '')
    else if (action === 'remove-card') this.removeCard(target.dataset.key || '')
    else if (action === 'pool-add') this.addPoolCard(target.dataset.key || '')
    else if (action === 'pool-remove') this.removePoolCard(Number(target.dataset.index))
    else if (action === 'pool-clear') { this.state.pool = []; this.persist(); this.render() }
    else if (action === 'deck-clear') this.setDeckCard(Number(target.dataset.slot) as DeckSlot, '')
    else if (action === 'add-aura') this.addAura(target.dataset.kind as 'stat' | 'ability', target.dataset.name || '')
    else if (action === 'remove-aura') this.removeAura(target.dataset.kind as 'stat' | 'ability', target.dataset.name || '')
    else if (action === 'start-search') this.startSearch()
    else if (action === 'cancel-search') this.cancelWorker()
    else if (action === 'ranking') { this.ranking = target.dataset.ranking as Ranking; this.render() }
    else if (action === 'use-result') this.useResult(target.dataset.result || '')
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
    if (zone.dataset.dropZone === 'pool') {
      if (origin === 'inventory') this.addPoolCard(encodedKey)
      return
    }
    if (zone.dataset.dropZone === 'deck') this.setDeckCard(Number(zone.dataset.slot) as DeckSlot, encodedKey)
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
    this.state.pool = this.state.pool.filter((card) => teamCardVariantKey(card) !== key)
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
    this.state.pool = this.state.pool.map(remap)
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

  private addPoolCard(encodedKey: string) {
    const card = this.findOwnedCard(encodedKey)
    if (!card) return
    const key = cardVariantKey(card.cardName, card.borders)
    const used = this.state.pool.filter((entry) => teamCardVariantKey(entry) === key).length
    if (used >= card.quantity) {
      this.error = `You only own ${card.quantity} copy${card.quantity === 1 ? '' : 'ies'} of ${card.cardName} · ${borderLabel(card.borders)}.`
      this.render()
      return
    }
    this.state.pool.push({ cardName: card.cardName, borders: canonicalBorders(card.borders) })
    this.error = ''
    this.persist(); this.render()
  }

  private removePoolCard(index: number) {
    if (!Number.isInteger(index) || index < 0 || index >= this.state.pool.length) return
    this.state.pool.splice(index, 1)
    this.persist(); this.render()
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
    const inventory = this.poolInventory()
    if (inventory.cards.reduce((sum, card) => sum + card.quantity, 0) < 4) {
      this.error = 'Drag at least 4 owned copies into the Pool before optimizing.'
      this.render()
      return
    }
    this.runWorker({ kind: 'search', inventory: structuredClone(inventory) })
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
    this.persist(); this.tab = 'pool'; this.render()
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
