import fs from 'node:fs'
const app=fs.readFileSync('src/app.ts','utf8'); const search=fs.readFileSync('src/optimizer/search.ts','utf8'); const types=fs.readFileSync('src/app-types.ts','utf8')
for(const h of ['start-search-fast','start-search-full','Fast Search','Full Depths Search']) if(!app.includes(h)) throw new Error('missing '+h)
for(const h of ["mode: 'full'",'FAST_QUICK_TRIALS = 2','FAST_SEARCH_FINALIST_CAP = 10','approximateFinalMetrics','Running fast approximate finalist checks','Running parallel exact Depths batches for finalists']) if(!search.includes(h)) throw new Error('missing '+h)
if(!types.includes("export type SearchMode = 'fast' | 'full'")) throw new Error('SearchMode missing')
console.log('Fast/full optimizer mode regression passed.')
