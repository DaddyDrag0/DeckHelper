import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const app = readFileSync('src/app.ts', 'utf8')
const css = readFileSync('src/aura-workspace.css', 'utf8')
assert.ok(app.includes("type Tab = 'pool' | 'auras' | 'optimize' | 'decks'"), 'Auras workspace tab is missing')
assert.ok(app.includes("this.tabButton('auras', 'Auras')"), 'Auras tab button is missing')
assert.ok(app.includes('private renderAuras()'), 'Dedicated Auras page is missing')
assert.ok(!app.includes('<section class="aura-inventory-panel">'), 'Aura catalog should not remain inside the right inventory panel')
assert.ok(app.includes("const AURA_BORDERS: AuraOwnedBorder[] = ['Base', 'Platinum', 'Crystal', 'Galaxy']"), 'Aura border choices must be Base/P/C/G only')
assert.ok(css.includes('repeat(4') && css.includes('.aura-workspace .aura-columns'), 'Aura workspace layout CSS is missing')
console.log('aura workspace regression passed')
