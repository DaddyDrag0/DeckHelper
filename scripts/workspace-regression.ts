import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { defaultState } from '../src/storage'

const state = defaultState()
assert.deepEqual(state.pool, [], 'New state should start with an empty optimizer pool')

const app = readFileSync('src/app.ts', 'utf8')
const styles = readFileSync('src/styles.css', 'utf8')
assert.ok(app.includes('data-drop-zone="pool"'), 'Pool drop zone is missing')
assert.ok(app.includes('data-drag-card='), 'Inventory cards are not draggable')
assert.ok(app.includes('poolInventory()'), 'Optimizer pool filtering is missing')
assert.ok(app.includes('used >= card.quantity'), 'Pool does not enforce owned quantities')
assert.ok(app.includes('conic-gradient'), 'Stacked border color mixing is missing')
assert.ok(styles.includes('.workspace-layout') && styles.includes('.inventory-side'), 'Two-column workspace styling is missing')
assert.ok(styles.includes('.card-art-frame'), 'Bordered card art styling is missing')
console.log('workspace regression passed')
