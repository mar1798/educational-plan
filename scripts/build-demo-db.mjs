/**
 * Собирает демо-БД, которую дистрибутив разворачивает при первом запуске
 * (см. `installSeedDb` в src/main/index.ts). Вызывается из `build:win`/`build:mac`.
 *
 * Отдельный файл, а не однострочник в package.json: удаление каталога и запуск seed-скрипта
 * нужно делать одинаково на macOS и на Windows-раннере CI, где npm прогоняет скрипты через
 * cmd.exe и экранирование кавычек в `node -e "…"` ненадёжно.
 *
 * Каталог удаляется целиком: seed-скрипт без `--force` откажется писать в непустую БД, а с
 * `--force` положит рядом копию прежнего файла — лишний мусор в ресурсах дистрибутива.
 */
import { spawnSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const target = join('resources', 'demo', 'college.db')

rmSync(join(root, 'resources', 'demo'), { recursive: true, force: true })

const result = spawnSync(
  process.execPath,
  [join(root, 'scripts', 'electron-node.mjs'), './node_modules/tsx/dist/cli.mjs', 'scripts/seed-demo.ts', target],
  { cwd: root, stdio: 'inherit' },
)
process.exit(result.status ?? 1)
