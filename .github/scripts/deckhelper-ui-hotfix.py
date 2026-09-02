from pathlib import Path

revamp = Path('src/revamp.ts')
s = revamp.read_text()

old_qty = """  private changeQuantity(encodedKey: string, delta: number) {
    const card = this.findOwned(encodedKey)
    if (!card) return
    card.quantity = Math.max(1, Math.min(999, card.quantity + delta))
    this.persist(); this.render()
  }"""
new_qty = """  private changeQuantity(encodedKey: string, delta: number) {
    const card = this.findOwned(encodedKey)
    if (!card) return
    if (delta < 0 && card.quantity <= 1) {
      this.removeCard(encodedKey)
      return
    }
    card.quantity = Math.max(1, Math.min(999, card.quantity + delta))
    this.persist(); this.render()
  }"""
if old_qty in s:
    s = s.replace(old_qty, new_qty, 1)
elif "if (delta < 0 && card.quantity <= 1)" not in s:
    raise SystemExit('changeQuantity block not found')

needle_lock = """        }).join('')}</div>` : ''}
      </div>
      <details class=\"rv-advanced-row\">"""
replacement_lock = """        }).join('')}</div>` : ''}
        <button class=\"rv-remove-card\" data-action=\"remove-card\" data-key=\"${key}\">Remove</button>
      </div>
      <details class=\"rv-advanced-row\">"""
if needle_lock in s:
    s = s.replace(needle_lock, replacement_lock, 1)
elif 'class=\"rv-remove-card\"' not in s:
    raise SystemExit('inventory lock block not found')

advanced_remove = """
        <button class=\"rv-danger-link\" data-action=\"remove-card\" data-key=\"${key}\">Remove card</button>"""
s = s.replace(advanced_remove, '', 1)

old_result_start = """  private renderResult(result: RankedTeam, index: number) {
    return `<article class=\"rv-result-card ${index === 0 ? 'winner' : ''}\">"""
new_result_start = """  private renderResult(result: RankedTeam, index: number) {
    const powerEstimate = result.quickEstimate ?? result.metrics.medianDepth
    return `<article class=\"rv-result-card ${index === 0 ? 'winner' : ''}\">"""
if old_result_start in s:
    s = s.replace(old_result_start, new_result_start, 1)
elif 'const powerEstimate = result.quickEstimate' not in s:
    raise SystemExit('renderResult start not found')

old_meta = """      <div class=\"rv-result-meta\"><span>Stat Aura <b>${escapeHtml(auraLabel(result.loadout.statAura))}</b></span><span>Ability Aura <b>${escapeHtml(auraLabel(result.loadout.abilityAura))}</b></span>${this.searchMode === 'full' ? `<span>Median Depth <b>${formatNumber(result.metrics.medianDepth)}</b></span><span>Average <b>${formatNumber(result.metrics.averageDepth, 1)}</b></span>` : `<span>Power estimate <b>${formatNumber(result.metrics.medianDepth)}</b></span>`}</div>"""
new_meta = """      <div class=\"rv-result-meta\"><span>Stat Aura <b>${escapeHtml(auraLabel(result.loadout.statAura))}</b></span><span>Ability Aura <b>${escapeHtml(auraLabel(result.loadout.abilityAura))}</b></span><span>Power estimate <b>~${formatNumber(powerEstimate)}</b></span>${this.searchMode === 'full' ? `<span>Median Depth <b>${formatNumber(result.metrics.medianDepth)}</b></span><span>Average <b>${formatNumber(result.metrics.averageDepth, 1)}</b></span>` : `<span>Estimated Depth <b>${formatNumber(result.metrics.medianDepth)}</b></span>`}</div>"""
if old_meta in s:
    s = s.replace(old_meta, new_meta, 1)
elif '<span>Power estimate <b>~${formatNumber(powerEstimate)}</b></span>' not in s:
    raise SystemExit('result meta block not found')

revamp.write_text(s)

css = Path('src/revamp.css')
c = css.read_text()
remove_css = '.rv-remove-card{border:1px solid #4d2b31;background:#211417;color:#d98b93;border-radius:8px;padding:6px 10px;font-size:10px;font-weight:750}.rv-remove-card:hover{background:#2b181c;border-color:#704049}'
if '.rv-remove-card{' not in c:
    c += remove_css
css.write_text(c)
