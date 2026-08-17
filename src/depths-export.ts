import type { TeamLoadout } from './types'

export const DEPTHS_CALCULATOR_URL = 'https://daddydrag0.github.io/CardRngExpansionDepths/'

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/=+$/g, '').replace(/\+/g, '-').replace(/\//g, '_')
}

export function encodeDepthsTeam(loadout: TeamLoadout): string {
  if (loadout.cards.length !== 4) throw new Error('Depths export requires exactly 4 cards.')
  const payload = {
    v: 1,
    c: loadout.cards.map((slot) => [slot.cardName, [...slot.borders]]),
    s: [loadout.statAura?.auraName || '', loadout.statAura?.border || ''],
    a: [loadout.abilityAura?.auraName || '', loadout.abilityAura?.border || ''],
  }
  return `CRE1-${toBase64Url(JSON.stringify(payload))}`
}

export function depthsExportUrl(loadout: TeamLoadout): string {
  const url = new URL(DEPTHS_CALCULATOR_URL)
  url.searchParams.set('team', encodeDepthsTeam(loadout))
  return url.toString()
}
