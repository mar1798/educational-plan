import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const SOLVER_DIR = join(__dirname, '../../src/solver')
const FORBIDDEN = [/^electron$/, /^better-sqlite3$/, /^drizzle-orm/, /^node:/, /^\.\.\/main\//]

function listFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    return statSync(full).isDirectory() ? listFiles(full) : [full]
  })
}

function importsOf(source: string): string[] {
  const matches = source.matchAll(/from\s+['"]([^'"]+)['"]/g)
  return [...matches].map((m) => m[1]!)
}

describe('изоляция src/solver (§3.4)', () => {
  it('не импортирует electron/БД/node из ядра солвера', () => {
    for (const file of listFiles(SOLVER_DIR)) {
      const imports = importsOf(readFileSync(file, 'utf-8'))
      for (const spec of imports) {
        const violated = FORBIDDEN.some((re) => re.test(spec))
        expect(violated, `${file} импортирует запрещённый модуль "${spec}"`).toBe(false)
      }
    }
  })
})
