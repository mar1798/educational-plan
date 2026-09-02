import { describe, expect, it } from 'vitest'
import { solve } from '../../src/solver'

describe('solve (заглушка)', () => {
  it('возвращает пустой результат без падений', () => {
    const result = solve({ seed: 1 })
    expect(result).toEqual({ placed: 0, penalty: 0 })
  })
})
