import './revamp.css'
import { DeckHelperRevamp } from './revamp'

const root = document.querySelector<HTMLElement>('#app')
if (!root) throw new Error('Missing #app root')

new DeckHelperRevamp(root).start()
