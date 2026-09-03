/**
 * Детерминированный ГПСЧ (mulberry32) — воспроизводимость результата по seed (§5.6):
 * тот же вход + seed = тот же результат, что делает возможными регрессионные тесты качества.
 */
export class Rng {
  private state: number

  constructor(seed: number) {
    this.state = seed >>> 0
  }

  /** Следующее целое в [0, 2^32). */
  nextUint32(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0
    let t = this.state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return (t ^ (t >>> 14)) >>> 0
  }

  /** Следующее вещественное в [0, 1). */
  nextFloat(): number {
    return this.nextUint32() / 0x100000000
  }

  /** Целое в [0, max). */
  nextInt(max: number): number {
    return Math.floor(this.nextFloat() * max)
  }

  /** Случайный элемент непустого массива (тай-брейк при равных вариантах). */
  pick<T>(items: readonly T[]): T {
    return items[this.nextInt(items.length)]!
  }
}
