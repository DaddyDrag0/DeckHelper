# November 2026 data sync — draft

Staged, **not yet published**: card, ability, aura and thumbnail exports
from the November 2026 Expansion Depths overhaul test branch.

- Card catalog: 308 → 348 distinct calculator entries.
- Includes new virtues, boss cards, Halloween 3 and mythical-weather cards.
- The current Era 2 `Count Muscula` and `Skeleton King` remain their existing
  canonical names; low-rarity historical variants use calculator-only
  `(Legacy)` suffixes to avoid ambiguous lookups.
- This synchronizes **source data only**. The older DeckHelper engine,
  optimizer, mutation picker and browser worker do not yet implement all
  November 2026 special ability effects. Do not claim their results are
  verified for the new cards.
- Before merging, verify optimizer/search constraints, update supported
  mutation types and compiled live assets, and run CI plus real-match checks.

Do not merge/publish solely because data-integrity tests pass.
