export class SeededRng {
  private state: number

  constructor(seed: number) {
    this.state = (seed >>> 0) || 0x9e3779b9
  }

  next(): number {
    // Deterministic calculator RNG for reproducible tests. This is not claimed to match Roblox math.random bit-for-bit.
    let t = (this.state += 0x6d2b79f5)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
