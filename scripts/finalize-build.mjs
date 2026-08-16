import { existsSync, renameSync, unlinkSync } from 'node:fs'

if (existsSync('dist/index.html')) unlinkSync('dist/index.html')
renameSync('dist/source.html', 'dist/index.html')
