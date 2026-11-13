// Known post-October 2026 cards whose source mechanics have NOT yet been
// ported into DeckHelper's legacy TypeScript simulator.
// Keep these explicitly untrusted, and fail coverage tests for new gaps.
export const UNPORTED_NOV_2026_ABILITIES = new Set([
  'Behind Reality', 'Cracked Crown', 'Crushing Depths', 'Cursed Orchard',
  'Delayed Impact', 'Devour the Deep', 'Dimensional Slip', 'Divine Flood',
  'Dream Doppelgänger', 'Eternal Slumber', 'Forgotten Existence',
  'Haunted Heirloom', 'King of Horror', 'Lucid Dream',
  'Never Fall Asleep', 'Perfect Reflection', 'Rewrite Existence',
  'Sands of Renewal', "Siren's Song", 'Stone Vigil', 'Sunken Kingdom',
  'Terrorize',
])
