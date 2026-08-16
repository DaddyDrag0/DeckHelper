import './styles.css'

const app = document.querySelector<HTMLElement>('#app')

if (!app) throw new Error('Missing #app root')

app.innerHTML = `
  <section class="shell">
    <p class="eyebrow">Card Fantasy RNG</p>
    <h1>DeckHelper</h1>
    <p class="lede">
      Simulator foundation is being validated first. Inventory and optimizer features will be built on top of the copied Depths battle engine after parity checks pass.
    </p>
    <div class="status-card">
      <strong>Phase 1</strong>
      <span>Battle engine + Depths data migration and regression verification</span>
    </div>
  </section>
`
