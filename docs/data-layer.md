# Слой данных: правила записи, аудит, откат, миграции

Принципы — PLAN.md §4.1. Здесь — как это выглядит в коде и что легко сломать.

## Золотое правило

**Любая запись идёт через `src/main/db/repo/base-repo.ts`**, а не прямым
`db.insert()/update()/delete()`:

| Функция | Что делает сверх запроса |
|---|---|
| `createRow(tx, table, values, ctx)` | проставляет `created_at`/`updated_at`/`row_version = 1`, пишет `change_log`, при наличии `ctx.operationId` — снимок в `operation_snapshot` |
| `updateRow(tx, table, id, patch, expectedRowVersion, ctx)` | проверяет `row_version` → `OptimisticLockError`, инкрементирует его, аудит + снимок |
| `closeRow(...)` | «мягкое удаление»: проставляет `valid_to`, действие `close` в аудите |
| `deleteRow(tx, table, id, ctx)` | физическое удаление — только там, где ссылок быть не может |

Прямой `db.insert(...)` в продакшн-коде обходит аудит и оптимистичную блокировку. В тестах
(`seedMinimalWorld`) прямые вставки допустимы — там аудит не проверяется.

`ctx` (`AuditContext`) — `{ reason?, user?, operationId? }`. `reason` попадает в `change_log`
и виден пользователю в истории изменений (`EntityHistoryPanel`, канал `audit:entity`), так что
писать его по-русски и по делу: `'правка преподавателя'`, а не `'update'`.

## Операции и откат

Массовое изменение (генерация, раскатка шаблона, импорт, слияние групп, замены) оборачивается
в `runOperation(db, kind, params, fn)` из `repo/operations.ts`:

- одна транзакция, одна строка `operation` со статусом `applied`;
- все `createRow`/`updateRow` внутри, получившие `ctx.operationId`, сами копят снимки
  «до/после» в `operation_snapshot`;
- `undoOperation(db, operationId)` разворачивает их в обратном порядке, резолвя таблицу по
  имени через `repo/registry.ts::resolveTable` (реестр строится из `schema/index.ts`
  автоматически — вручную перечислять таблицы не нужно);
- `kind` — один из `generate | rollout | import | bulk_edit | restore | substitution`;
  расширение множества требует правки и `contract.ts`, и `schemas.ts` (`operationKind`).

Одиночная правка вне `runOperation` в аудит попадает, но undo для неё недоступен — снимок
пишется только при наличии `operationId`. Это осознанно.

## Историчность вместо удаления

- Связи и «мягкие» сущности имеют `valid_from`/`valid_to` (`NULL` = бессрочно). Удаление из
  UI = проставление `valid_to`; справочники верхнего уровня вместо этого архивируются
  (`archived_at`) или закрываются (`fired_at` у преподавателя).
- Все внешние ключи — `ON DELETE RESTRICT`. Перед физическим удалением вызывается
  `ensureDeletable(tx, label, id, checks)` из `repo/reference-guard.ts`: он считает ссылки по
  каждой указанной таблице и бросает `ReferencedError` с точным числом и русским
  существительным («используется в 3 строках нагрузки») — вместо разбора текста ошибки SQLite.
  Заводя новую таблицу со ссылкой на справочник, **добавь её в список `checks` соответствующего
  `*:delete`-хендлера** (пример — `ipc/teachers.ts`, там 7 проверок + 2 отдельные на
  `substitution`, потому что она ссылается двумя колонками).

## Типы и соглашения хранения

- Даты — `TEXT` в формате `YYYY-MM-DD`; метки времени — `TEXT` ISO-8601 UTC. Тип даты в
  SQLite отсутствует, ISO-строка корректно сортируется и сравнивается.
- Часы — **целые** академические часы, никаких `REAL`.
- Каждая таблица получает `auditColumns` из `schema/_helpers.ts`
  (`created_at`, `updated_at`, `row_version`) и `id()`.
- Прагмы задаются в `db/client.ts`: `journal_mode = WAL`, `foreign_keys = ON`,
  `synchronous = FULL` (данные ценнее скорости), `busy_timeout = 5000`.

## Жёсткие ограничения на уровне СУБД

Помимо проверок в сервисах, часть конфликтов гарантирована частичными уникальными индексами
(PLAN §4.4) — дешёвая страховка от программной ошибки:

- `uq_lesson_teacher` — `(teacher_id, date, pair_no)` при `status in ('planned','held')`;
- `uq_lesson_room` — то же по кабинету, при `room_id is not null`.

Пересечение подгрупп индексом не выражается и проверяется кодом (`solver/validate.ts::findConflicts`).
Тесты бьют по реальной вставке и ждут отказа БД — см. `tests/db/constraints.test.ts`.

## Миграции

1. Правишь `src/main/db/schema/*.ts`.
2. `npm run db:generate` — drizzle-kit кладёт SQL в `drizzle/` и обновляет `meta/_journal.json`.
   **Оба коммитятся.**
3. Ничего вручную применять не нужно: `src/main/index.ts` при старте вызывает
   `hasPendingMigrations()` и, если миграции есть, снимает бэкап `pre_migration`, затем
   `runMigrations()`. `npm run db:migrate` — только для отладки вне приложения.
4. В упакованной сборке миграции лежат в `process.resourcesPath/drizzle` — путь считает
   `migrationsPath()`; следи, чтобы `drizzle` оставался в `extraResources`
   (`electron-builder.yml`).

`hasPendingMigrations` сравнивает `max(created_at)` из `__drizzle_migrations` с метками `when`
из журнала: полный `VACUUM INTO` на каждый запуск — заметная задержка и вымывание истории
ротации, поэтому бэкап «перед миграцией» снимается только когда миграция действительно будет.

## Бэкапы

`db/backup/`:

- `backup.ts` — `VACUUM INTO` при каждом запуске и перед опасными операциями, ротация
  20 последних, запись в таблицу `backup` (`reason`: `schedule | pre_migration | manual | pre_restore`);
- `restore.ts` — закрыть БД → подменить файл → перезапустить приложение;
- `external-copy.ts` — напоминание о копии на внешний носитель, дата последней копии
  показывается на экране «Система» (`backup:externalStatus`).

## Схема: 36 таблиц

`org` — `speciality`, `building`, `room`, `pair_grid`.
`people` — `teacher_category`, `teacher`, `cmc`, `teacher_qualification`, `teacher_absence`,
`study_group`, `division_scheme`, `subgroup`.
`curriculum` — `discipline`, `curriculum`, `curriculum_row`, `curriculum_week`.
`load` — `stream`, `stream_member`, `teaching_load`.
`calendar` — `academic_year`, `semester`, `calendar_day`, `calendar_period`.
`schedule` — `schedule_template`, `template_entry`, `lesson`, `lesson_group`, `substitution`.
`system` — `constraint_weight`, `operation`, `operation_snapshot`, `change_log`, `backup`, `other_load`.
`import` — `import_profile`. `app-setting` — `app_setting`.

Ключевое различие: **`template_entry`** — типовая неделя (`day_of_week`, `pair_no`,
`week_parity`, `is_locked`, `source`), **`lesson`** — материализованная дата (`date`,
`pair_no`, `status`, `operation_id`). Раскатка шаблона превращает первое во второе;
`lesson_group` хранит, какие группы и какие позиции студентов (`pos_from`/`pos_to`) на занятии —
именно поэтому занятие не привязано к одной группе (потоковые лекции, PLAN §4.7).
