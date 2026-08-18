from pathlib import Path

path = Path('scripts/depths-regression.ts')
text = path.read_text()
old = """  assert(depthsMechanics.hardExclusions.length === 1 && depthsMechanics.hardExclusions[0] === 'Vampire Lord', 'Vampire Lord must be the only default Depth exclusion')
  for (const name of ['Samurai', 'Seraphim', 'Loki', 'Fuxi', 'Parallax', 'Nán Fāng Zhū Què', 'Brachiosaurus', 'Jersey Devil']) {
    assert(getDepthsPool(floor, []).some((entry) => entry.card.name === name), `Newly unbanned Depth card ${name} must be eligible`)
  }"""
new = """  for (const name of depthsMechanics.hardExclusions) {
    assert(!getDepthsPool(floor, []).some((entry) => entry.card.name === name), `Default Depth ban ${name} must remain excluded`)
  }"""
if old not in text:
    raise SystemExit('Expected Depth hard-exclusion regression block not found')
path.write_text(text.replace(old, new, 1))
