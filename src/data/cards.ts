import batch1 from './cards-1.json'
import batch2 from './cards-2.json'
import batch3 from './cards-3.json'
import batch4 from './cards-4.json'
import batch5 from './cards-5.json'
import batch6 from './cards-6.json'
import batch7 from './cards-7.json'
import type { CardDefinition } from '../types'

export const cards = [
  ...batch1,
  ...batch2,
  ...batch3,
  ...batch4,
  ...batch5,
  ...batch6,
  ...batch7,
] as CardDefinition[]

export default cards
