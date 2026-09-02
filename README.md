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
  `electron-builder.yml` готов, фактический прогон — этап 8 (Windows-релиз)

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
