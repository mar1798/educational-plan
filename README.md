# Расписание колледжа

Офлайн-приложение на Electron для составления расписания медицинского колледжа.
Архитектура, схема БД, алгоритм и разбивка на этапы — в [PLAN.md](./PLAN.md).

## Установка

```
npm install
```

`postinstall` автоматически прогоняет `electron-builder install-app-deps`, который
пересобирает нативный модуль `better-sqlite3` под ABI **Electron**, а не под ABI
Node.js. Без этого шага приложение падает при старте с ошибкой вида
`NODE_MODULE_VERSION mismatch`. Если модуль пришлось переустановить вручную —
запускать `npm run rebuild`, а не `npm rebuild`.

Обратная сторона: модуль, собранный под ABI Electron, **падает сегфолтом** под
обычным `node` (например, голый `tsx scripts/migrate.ts` или `vitest run`).
Поэтому `test`, `test:solver`, `test:watch`, `bench:solver`, `db:migrate` и
`seed:demo` в `package.json` запускаются не напрямую, а через
`scripts/electron-node.mjs` — он поднимает сам бинарник Electron в режиме
`ELECTRON_RUN_AS_NODE=1` (чистый Node-рантайм с тем же ABI, что и у собранного
модуля). Запускать эти команды нужно только через `npm run …`, не вызывать
`vitest`/`tsx` напрямую.

### Известная особенность: бинарник Electron может не скачаться сам

В некоторых окружениях npm не запускает собственный `postinstall`-скрипт пакета
`electron` (тот, что скачивает сам исполняемый файл под текущую платформу) —
после `npm install` `node_modules/electron/dist/` оказывается пустым, и
`npm run dev` падает с `Error: Electron uninstall`. Проверка и обход:

```
ls node_modules/electron/dist        # если пусто/нет — качаем вручную
node node_modules/electron/install.js
```

## Скрипты

См. таблицу в PLAN.md §2.2. Ключевые для повседневной разработки:

- `npm run dev` — запуск с hot reload
- `npm run typecheck` — проверка всех трёх изолированных tsconfig (main/preload,
  renderer, солвер)
- `npm test` / `npm run test:solver` — тесты
- `npm run build:mac` — сборка `.app` без инсталлятора, для локальной проверки
- `npm run build:win` — сборка `.exe`-инсталлятора (NSIS); конфиг в
  `electron-builder.yml` готов; CI-джоба `build-win` (`.github/workflows/ci.yml`)
  прогоняет её на `windows-latest` при каждом push/PR и выкладывает `.exe`
  артефактом — см. [docs/windows-install.md](./docs/windows-install.md)

## Статус

Этап 0 (каркас) выполнен: Electron + TS strict + SQLite/Drizzle с миграциями при
старте, IPC-контракт с zod-валидацией, заготовка `utilityProcess` для будущего
солвера (форк → прогресс → отмена), изоляция `src/solver` от Electron/Node
принудительно на трёх уровнях (tsconfig, ESLint, тест), упакованная сборка
`build:mac` проверена вручную — БД и `utilityProcess` работают из `.app`.

Иконка приложения — `build/icon.png` (1024×1024); `.icns` и `.ico` electron-builder
генерирует из неё сам, отдельные файлы в репозитории не нужны.

Не сделано и не входило в объём этапа 0: фактическая проверка `build:win`
(запланирована на этап 8).

Этап 1 (ядро данных) выполнен: все 35 таблиц §4.3 в Drizzle-схеме
(`src/main/db/schema/`), полная миграция сгенерирована; индексы и частичные
уникальные индексы §4.4 (в т.ч. `uq_lesson_teacher`/`uq_lesson_room`) проверены
тестом на реальный отказ БД при конфликте; базовый репозиторий
(`src/main/db/repo/base-repo.ts`) с оптимистичной блокировкой по `row_version`;
слой аудита `withAudit` — любая правка через репозиторий пишет `change_log`;
механизм операций `runOperation`/`undoOperation` (`src/main/db/repo/operations.ts`)
с `operation_snapshot` и откатом, проверенным на массовой правке 100 строк;
бэкапы через `VACUUM INTO` при каждом запуске и перед миграцией, ротация 20
последних (`src/main/db/backup/`); восстановление из бэкапа (закрыть → подменить
файл → перезапустить приложение); напоминание о копии на внешний носитель
(`external-copy.ts`); IPC-контракт расширен каналами `operations:*`,
`audit:entity`, `backup:*`. Все 20 новых тестов — в `tests/db/`.

Побочный результат этапа 1: `better-sqlite3` собран под ABI Electron (см. раздел
«Установка» выше) и падает сегфолтом под голым `node` — тесты и `db:migrate`
теперь запускаются через `scripts/electron-node.mjs`.

Не сделано и не входило в объём этапа 1: UI (справочники и экран бэкапов —
этап 2), реальные CRUD-хендлеры для конкретных сущностей (тоже этап 2 и далее) —
этап 1 закладывает только универсальный слой данных, которым они будут
пользоваться.

Этап 8 (Windows-релиз) — частично сделано, дальше нужна реальная Windows-машина.
Сделано: CI-джоба `build-win` на `windows-latest` (`.github/workflows/ci.yml`) —
`npm ci` пересобирает `better-sqlite3` под win32/x64 ABI Electron, `build:win`
паковает NSIS-инсталлятор, `.exe` выкладывается артефактом при каждом push/PR
(риск R1, PLAN.md §8); аудит путей в коде — везде `app.getPath()`/`path.join`,
явных склеек строк или unix-специфичных предположений не найдено; `nsis.perMachine:
false` зафиксирован явно в `electron-builder.yml` (установка без прав
администратора, в `%LOCALAPPDATA%`); инструкция по установке с описанием
SmartScreen — [docs/windows-install.md](./docs/windows-install.md).

Не сделано: два реальных скриншота SmartScreen (заглушки в
`docs/windows-install.md` помечены `TODO`), ручная проверка на живой Windows 11 —
путь с кириллицей и пробелами, установка/обновление поверх/удаление без
администратора, и приёмочный прогон на реальных данных колледжа вместе с
завучем. Это требует физического доступа к Windows-машине, поэтому не
закрывается из текущей среды разработки (macOS) — финальный пункт «Готово,
когда» этапа 8 (PLAN.md §10) может подтвердить только сам завуч.
