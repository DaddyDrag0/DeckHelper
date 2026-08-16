# DeckHelper

Independent Card Fantasy RNG deck builder / optimizer.

## Current phase: simulator foundation

The first milestone intentionally focuses on correctness before optimizer UI:

1. Copy the tested simulator source from `DaddyDrag0/CardRngExpansionDepths` into this repository.
2. Preserve card, ability, aura, border/stat, battle-order, RNG, and Depths generation/scaling behavior.
3. Verify the copied source is byte-for-byte aligned with the pinned Depths source commit and run the copied regression suite.
4. Only after simulator parity is established, build inventory and optimizer features.

The website is designed to run independently. It does **not** call the deployed Depths calculator at runtime.

### Engine source

Foundation source commit: `DaddyDrag0/CardRngExpansionDepths@1129767ec3b38d681332e1f3110b7c88ab69c63b`.

A sync workflow copies the engine/data/tests into this repository so future updates can be intentionally re-synced while the projects remain independently deployable.
