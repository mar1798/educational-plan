# Рабочий процесс: окружение, команды, грабли

## Главная особенность окружения

`better-sqlite3` — нативный модуль. `postinstall` (`electron-builder install-app-deps`)
пересобирает его под **ABI Electron**, а не под ABI Node. Следствие в обе стороны:

- без этого шага приложение падает при старте с `NODE_MODULE_VERSION mismatch`;
- собранный под Electron модуль **падает сегфолтом под голым `node`** — поэтому `vitest`,
  `tsx` и миграции запускаются через `scripts/electron-node.mjs`, который поднимает бинарник
  Electron в режиме `ELECTRON_RUN_AS_NODE=1` (чистый Node-рантайм, тот же ABI).

Отсюда правило: **`npm run …`, а не `npx vitest` / `npx tsx`**. Дисплей не нужен, окно не
открывается, xvfb в CI не требуется.

## Команды

| Команда | Что делает |
|---|---|
| `npm run dev` | Electron + hot reload (`electron-vite dev`) |
| `npm run typecheck` | три изолированных tsconfig подряд: `node` (main/preload/shared/scripts/tests), `web` (renderer), `solver` |
| `npm run lint` | ESLint, включая запрет импортов в `src/solver/**` |
| `npm test` | все тесты (`tests/**/*.test.ts`) |
| `npm run test:solver` | только `tests/solver` |
| `npm run test:watch` | vitest в watch-режиме |
| `npm run bench:solver` | бенчмарк солвера; сам выходит с кодом 1, если порог не выдержан |
| `npm run db:generate` | `drizzle-kit generate` после правки схемы |
| `npm run db:migrate` | применить миграции к рабочей БД вручную |
| `npm run db:studio` | drizzle-kit studio |
| `npm run seed:demo` | демо-данные |
| `npm run rebuild` | пересборка `better-sqlite3` под Electron вручную |
| `npm run build` | typecheck + `electron-vite build` |
| `npm run build:mac` | `.app` без инсталлятора — локальная проверка упакованной сборки |
| `npm run build:win` | NSIS `.exe` в `release/` |

Один файл тестов: `npm test -- tests/db/repo.test.ts`
Один кейс по имени: `npm test -- -t 'подстрока названия'`
(аргументы после `--` доходят до vitest через обёртку без изменений).

## Грабли, на которые уже наступали

**Пустой `node_modules/electron/dist/`.** В некоторых окружениях npm не запускает
postinstall самого пакета `electron`, и `npm run dev` падает с `Error: Electron uninstall`:

```
ls node_modules/electron/dist        # если пусто — качаем вручную
node node_modules/electron/install.js
```

**Ручная переустановка нативного модуля** — только `npm run rebuild`, не `npm rebuild`:
второй соберёт под ABI Node и вернёт сегфолт в тестах.

**Версии зафиксированы без `^`** для `electron` и `better-sqlite3` — ABI обоих обязан
совпадать, автоапдейт минорной версии ломает сборку.

**Preload собирается в CJS** принудительно (`electron.vite.config.ts`): сэндбоксированный
preload не понимает ESM даже с расширением `.mjs`.

**Renderer в упакованной сборке грузится по `file://`** — отсюда `createHashRouter`, а не
`BrowserRouter`, и CSP дублируется мета-тегом (в dev его нет, чтобы не ломать HMR).

## CI

`.github/workflows/ci.yml`, три джобы:

- `checks` (ubuntu) — `typecheck` + `lint` + `test`;
- `bench` (ubuntu) — `bench:solver` отдельно, прогон около минуты;
- `build-win` (windows-latest) — `npm ci` (пересборка под win32/x64 ABI) → `npm test`
  (проверяет и загрузку модуля под Windows, и пути с кириллицей — `tests/db/paths.test.ts`)
  → `build:win` → `.exe` выкладывается артефактом. Релиз из CI не публикуется намеренно.

## Тесты

- `tests/db/` — слой данных на **настоящем SQLite**: `helpers.ts::createTestDb()` создаёт БД
  во временной директории и прогоняет миграции, `seedMinimalWorld(db)` даёт минимальный
  связный набор (категория → преподаватель → корпус → кабинет → специальность → дисциплина →
  учебный план → семестр → группа → нагрузка → операция). Ограничения проверяются на реальный
  отказ вставки, а не на наличие индекса.
- `tests/solver/` — солвер под чистым Node, быстрый; фикстуры в `tests/fixtures/solver.ts`
  (`tightInput`, `roomyInput`, `fullCollegeInput`).
- `tests/import/` — движок сопоставления колонок (чистые функции, без Excel).

Подробности про пороги качества солвера — [solver.md](./solver.md).
