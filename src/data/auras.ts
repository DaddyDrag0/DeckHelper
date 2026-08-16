import batch1 from './auras-1.json'
import batch2 from './auras-2.json'
import type { AuraDefinition } from '../types'

export const auras = [...batch1, ...batch2] as AuraDefinition[]

export default auras
