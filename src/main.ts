import './styles.css'
import { DeckHelperApp } from './app'

const root = document.querySelector<HTMLElement>('#app')
if (!root) throw new Error('Missing #app root')

new DeckHelperApp(root).start()
