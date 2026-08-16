import batch1 from './abilities-1.json'
import batch2 from './abilities-2.json'
import batch3 from './abilities-3.json'
import batch4 from './abilities-4.json'

export const abilities = {
  ...batch1,
  ...batch2,
  ...batch3,
  ...batch4,
} as Record<string, string>

export default abilities
