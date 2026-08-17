import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { defaultState } from '../src/storage'

const state = defaultState()
assert.ok(!('pool' in state), 'Pool should be generated from the card catalog, not persisted state')

const app = readFileSync('src/app.ts', 'utf8')
const styles = readFileSync('src/styles.css', 'utf8')
assert.ok(app.includes("!card.unobtainable || card.name.toLowerCase().includes('conqueror')"), 'Pool must exclude unobtainable cards except Conqueror')
assert.ok(app.includes('data-drop-zone=\"inventory\"'), 'Inventory drop destination is missing')
assert.ok(app.includes("data-action=\"pool-border\""), 'Pool PCRG selection is missing')
assert.ok(app.includes('addOwnedVariant'), 'Pool-to-inventory variant add/quantity merge is missing')
assert.ok(app.includes('structuredClone(this.state.inventory)'), 'Optimizer should search the owned inventory')
assert.ok(!app.includes('poolInventory()') && !app.includes('this.state.pool'), 'Legacy optimizer candidate pool is still active')
assert.ok(app.includes('conic-gradient'), 'Stacked border color mixing is missing')
assert.ok(app.includes('aura-border-choice'), 'Visible single-choice aura border controls are missing')
assert.ok(app.includes("const AURA_BORDERS: AuraOwnedBorder[] = ['Base', 'Platinum', 'Crystal', 'Galaxy']"), 'Aura borders must be Base/Platinum/Crystal/Galaxy only')
assert.ok(!app.includes('data-action=\"aura-border\"'), 'Legacy stackable aura border checkboxes are still present')
assert.ok(styles.includes('.workspace-layout') && styles.includes('.inventory-side'), 'Two-column workspace styling is missing')
assert.ok(styles.includes('.pool-catalog-grid') && styles.includes('.pool-border-picker'), 'Pool catalog styling is missing')
assert.ok(styles.includes('compact-card-layout'), 'Compact inventory/aura card layout marker is missing')
assert.ok(styles.includes('.inventory-variant-list{grid-template-columns:repeat(2,minmax(0,1fr))'), 'Owned inventory should render side-by-side cards')
assert.ok(styles.includes('.aura-workspace .aura-column{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr))'), 'Aura catalog should render normal card-sized tiles')
console.log('workspace regression passed')
