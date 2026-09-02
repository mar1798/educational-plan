#!/usr/bin/env node
// better-sqlite3 собран под ABI Electron (postinstall), а не под ABI Node —
// поэтому tsx/vitest падают под обычным `node` с сегфолтом. Обходной путь,
// задокументированный в экосистеме Electron: запускать их под самим Electron
// в режиме ELECTRON_RUN_AS_NODE, где ABI совпадает с собранным модулем.
import { spawnSync } from 'node:child_process'
import electronPath from 'electron'

const result = spawnSync(electronPath, process.argv.slice(2), {
  stdio: 'inherit',
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
})

process.exit(result.status ?? 1)
