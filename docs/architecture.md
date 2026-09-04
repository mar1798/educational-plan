# Карта репозитория и границы слоёв

Общая схема слоёв — PLAN.md §3.1. Здесь — где что лежит фактически и какие границы
удерживаются принудительно.

## Поток данных

```
renderer/src/features/*Page.tsx
   └─ api/client.ts  →  window.api.invoke(channel, input)      (preload — только мост)
        └─ main/ipc/<домен>.ts   handle(channel, zodSchema, fn)  ← валидация + Result
             └─ main/db/repo/*.ts (Drizzle; только здесь SQL)
                  └─ SQLite (better-sqlite3, WAL)

main/ipc/generation.ts → solver-host/manager.ts ──fork──▶ utilityProcess
                                                            └─ solver-host/entry.ts → solver/solve()
```

## Директории

| Путь | Содержимое |
|---|---|
| `src/main/index.ts` | старт: бэкап → миграции → сиды (`ensurePairGrid`, `ensureTeacherCategories`, `ensureConstraintWeights`) → регистрация ~30 наборов IPC-хендлеров → окно |
| `src/main/ipc/` | по файлу на домен, каждый экспортирует `register<Домен>Handlers(db, …)`; `register.ts` — обёртка `handle()` |
| `src/main/db/schema/` | Drizzle-схема, 36 таблиц, сгруппированы по темам (`org`, `people`, `curriculum`, `load`, `calendar`, `schedule`, `system`, `import`, `app-setting`) |
| `src/main/db/repo/` | запросы и доменные правила уровня данных; `base-repo.ts`, `operations.ts`, `audit.ts`, `registry.ts` — универсальные |
| `src/main/db/backup/` | `backup.ts` (`VACUUM INTO` + ротация), `restore.ts`, `external-copy.ts` |
| `src/main/services/` | `snapshot.ts` и `apply-solution.ts` — **единственный** мост между доменом и солвером |
| `src/main/solver-host/` | `manager.ts` (fork, таймауты), `entry.ts` (внутри utilityProcess), `protocol.ts` (типы сообщений) |
| `src/main/import/`, `src/main/export/` | чтение xlsx (`exceljs`) и применение строк; экспорт в Excel и PDF (`printToPDF` в скрытом окне) |
| `src/preload/` | тонкий мост, логики нет |
| `src/renderer/src/app/` | `AppShell`, `router.tsx` (`createHashRouter`), `nav.ts`, `ErrorBoundary` |
| `src/renderer/src/ui/` | переиспользуемое: `ReferenceCrudPage`, `DataTable`, `Dialog`, `ConfirmDialog`, `EntityHistoryPanel`, `Select`, `form/*Field`, `toast.ts`, `locale.ts` |
| `src/renderer/src/features/` | по директории на раздел; страницы, роут в `router.tsx`, пункт меню в `nav.ts` |
| `src/shared/ipc/` | `contract.ts` (типы каналов и событий) и `schemas.ts` (zod) |
| `src/shared/import/engine.ts` | чистый движок импорта (используется и main, и renderer) |
| `src/shared/schedule/` | `messages.ts` (русские тексты конфликтов), `weights.ts` |
| `src/solver/` | чистый TS-солвер |
| `drizzle/` | сгенерированные SQL-миграции + `meta/_journal.json`; коммитятся |
| `patterns/` | образцы xlsx, **не** данные и не спецификация формата |

**Пустые директории-заглушки** из первоначальной раскладки PLAN §2: `src/main/audit/`,
`src/main/backup/`, `src/main/db/repositories/`, `src/shared/domain/`,
`src/renderer/src/components/ui/`, `src/renderer/src/print/`, `samples/`. Реальный код живёт
в `db/repo/`, `db/backup/`, `renderer/src/ui/`. Не класть новое в пустые — либо удалить их,
либо игнорировать.

## Границы, которые нельзя нарушать

**1. Renderer не формулирует бизнес-правило.** Он не решает, можно ли поставить занятие, —
он спрашивает main. Единственное исключение: импорт чистого `src/solver/validate.ts` для
оптимистичной подсветки конфликтов при перетаскивании; авторитетная проверка перед записью
всё равно идёт в main **тем же кодом** (`repo/schedule-template.ts` вызывает `findConflicts`).

**2. `src/shared/` не зависит от `src/main/`.** Типы справочников в `contract.ts`
продублированы руками намеренно — не заменять импортом из `db/schema`, иначе renderer
потянет за собой Drizzle.

**3. `src/solver/` не знает про Electron, Node и БД.** Держится на трёх уровнях:
`tsconfig.solver.json` (без `types`, без DOM), ESLint `no-restricted-imports` для
`src/solver/**` (`electron`, `better-sqlite3`, `drizzle-orm`, `node:*`, `../main/*`) и
`tests/solver/isolation.test.ts`, который рекурсивно читает импорты.

**4. Только `db/repo/` знает SQL.** IPC-хендлеры простых справочников допускают прямой
`db.select()` для чтения, но любая **запись** идёт через `base-repo` — см.
[data-layer.md](./data-layer.md).

## Ошибки

`src/main/ipc/register.ts::handle()` — единственная точка выхода наружу. Всё
заворачивается в `Result<T, AppError>`, исключения не летят в renderer. `toAppError`
переводит доменные исключения в коды с русским текстом:

| Исключение / признак | Код | Смысл для пользователя |
|---|---|---|
| `OptimisticLockError` | `CONFLICT` | запись изменил кто-то другой |
| `NotFoundError` | `NOT_FOUND` | |
| `ReferencedError`, `LockedEntryError` | `BLOCKED` | используется в других разделах / запись закреплена |
| `ScheduleConflictError` | `SCHEDULE_CONFLICT` | в `details` — список причин |
| `FOREIGN KEY` / `UNIQUE` / `NOT NULL` от SQLite | `BLOCKED` / `VALIDATION_ERROR` | английский текст SQLite до завуча не доходит |
| остальное | `INTERNAL_ERROR` | |

Новый тип доменной ошибки **обязан** быть добавлен в `toAppError`, иначе схлопнется в
`INTERNAL_ERROR` и UI не сможет предложить осмысленное действие.

## Асинхронная генерация

Жизненный цикл (PLAN §3.5) реализован в `ipc/generation.ts` + `solver-host/manager.ts`:

1. `generation:start` — снимок собирается в одной читающей транзакции (`buildSolverInput`),
   заводится `jobId`, поднимается `utilityProcess`.
2. `generation:progress` / `generation:done` / `generation:failed` — односторонние события
   main → renderer.
3. Результат **не пишется в БД**: он лежит черновиком в памяти main (`drafts`, максимум 3 —
   это снимки на десятки мегабайт), до явного `generation:apply`.
4. Отмена кооперативная: `localSearch` отдаёт event loop, хост всё равно присылает `done` —
   поэтому отменённые `jobId` помечаются в `cancelled`, чтобы поздний `done` не воскресил
   черновик. Жёсткое убийство процесса — страховка по таймауту (1 с; 10 с для режима
   «остановить и взять результат»).
