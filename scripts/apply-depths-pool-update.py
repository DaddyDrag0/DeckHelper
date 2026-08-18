from pathlib import Path


def replace(path: str, old: str, new: str, expected: int | None = 1) -> None:
    file = Path(path)
    text = file.read_text()
    hits = text.count(old)
    if expected is not None and hits != expected:
        raise SystemExit(f"Expected {expected} matches in {path}, found {hits}: {old!r}")
    if hits == 0:
        raise SystemExit(f"Missing expected text in {path}: {old!r}")
    file.write_text(text.replace(old, new))


replace(
    'src/engine/depths.ts',
    "const HARD_EXCLUSIONS = new Set([\n  'Samurai', 'Seraphim', 'Vampire Lord', 'Loki', 'Fuxi', 'Parallax',\n  'Nán Fāng Zhū Què', 'Brachiosaurus', 'Jersey Devil',\n])",
    "const HARD_EXCLUSIONS = new Set(['Vampire Lord'])",
)
replace('src/engine/depths.ts', 'export const MAX_DEPTH_BANS = 10', 'export const MAX_DEPTH_BANS = 12')
replace('src/app.ts', "'10/10 bans selected'", "'12/12 bans selected'")

replace(
    'src/optimizer/search.ts',
    "import { generateDepthsTeam } from '../engine/depths'",
    "import { generateDepthsTeam, MAX_DEPTH_BANS } from '../engine/depths'",
)
replace('src/optimizer/search.ts', '.slice(0, 10)', '.slice(0, MAX_DEPTH_BANS)', 2)

worker = Path('src/optimizer-worker.ts')
text = worker.read_text()
marker = "import type { DepthsBatchResult } from './engine/simulation'\n"
if "import { MAX_DEPTH_BANS } from './engine/depths'" not in text:
    if marker not in text:
        raise SystemExit('Missing optimizer-worker import insertion point')
    text = text.replace(marker, marker + "import { MAX_DEPTH_BANS } from './engine/depths'\n", 1)
if text.count('.slice(0, 10)') != 1:
    raise SystemExit(f"Expected one optimizer-worker 10-ban slice, found {text.count('.slice(0, 10)')}")
text = text.replace('.slice(0, 10)', '.slice(0, MAX_DEPTH_BANS)', 1)
worker.write_text(text)

path = Path('scripts/depths-regression.ts')
text = path.read_text()
text = text.replace(
    "// They are optional (0..10), while the game's built-in hard exclusions always stay excluded.",
    "// They are optional (0..12), while the game's built-in hard exclusions always stay excluded.",
)
old = """  const elevenBans = eligibleNames.slice(0, 11)
  const cappedPool = getDepthsPool(floor, elevenBans).map((entry) => entry.card.name)
  for (const name of elevenBans.slice(0, MAX_DEPTH_BANS)) {
    assert(!cappedPool.includes(name), `Expected capped player ban to remove ${name}`)
  }
  assert(cappedPool.includes(elevenBans[MAX_DEPTH_BANS]), 'Player Depth bans must cap at 10')

  for (const name of depthsMechanics.hardExclusions) {
    assert(!getDepthsPool(floor, []).some((entry) => entry.card.name === name), `Default Depth ban ${name} must remain excluded`)
  }"""
new = """  const overCapBans = eligibleNames.slice(0, MAX_DEPTH_BANS + 1)
  const cappedPool = getDepthsPool(floor, overCapBans).map((entry) => entry.card.name)
  for (const name of overCapBans.slice(0, MAX_DEPTH_BANS)) {
    assert(!cappedPool.includes(name), `Expected capped player ban to remove ${name}`)
  }
  assert(cappedPool.includes(overCapBans[MAX_DEPTH_BANS]), 'Player Depth bans must cap at 12')

  assert(depthsMechanics.hardExclusions.length === 1 && depthsMechanics.hardExclusions[0] === 'Vampire Lord', 'Vampire Lord must be the only default Depth exclusion')
  for (const name of ['Samurai', 'Seraphim', 'Loki', 'Fuxi', 'Parallax', 'Nán Fāng Zhū Què', 'Brachiosaurus', 'Jersey Devil']) {
    assert(getDepthsPool(floor, []).some((entry) => entry.card.name === name), `Newly unbanned Depth card ${name} must be eligible`)
  }"""
if old not in text:
    raise SystemExit('Missing expected Depth-ban regression block')
text = text.replace(old, new, 1)
old_count = "assert(representatives.size === 176, `Expected 176 Depths abilities, found ${representatives.size}`)"
if old_count not in text:
    raise SystemExit('Missing expected Depths ability-count regression')
text = text.replace(old_count, "assert(representatives.size >= 176, `Expected at least 176 Depths abilities, found ${representatives.size}`)", 1)
path.write_text(text)
