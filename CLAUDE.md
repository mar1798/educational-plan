# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Проект и общение — на русском. Комментарии в коде объясняют «почему», а не «что», и ссылаются
на разделы исходного плана проектирования (`§4.6`, `§3.4`) — держать этот стиль. Сам план
удалён из рабочего дерева и доступен в истории (`git show f6f2458:PLAN.md`); всё, что нужно
в работе, перенесено в доки ниже.

## Справочники

Читать по мере надобности, не целиком:

| Документ | Когда открывать |
|---|---|
| [docs/decisions.md](./docs/decisions.md) | **источник истины по предметной области**: 47 принятых решений и непроверенные допущения |
| [docs/dev-workflow.md](./docs/dev-workflow.md) | команды, окружение, ABI-грабли, CI, устройство тестов |
| [docs/architecture.md](./docs/architecture.md) | карта репозитория, границы слоёв, обработка ошибок, жизненный цикл генерации |
| [docs/data-layer.md](./docs/data-layer.md) | запись в БД, аудит, операции и откат, историчность, миграции, бэкапы, 36 таблиц |
| [docs/solver.md](./docs/solver.md) | устройство солвера, изоляция, веса, пороги качества |
| [docs/adding-a-feature.md](./docs/adding-a-feature.md) | рецепты: новый IPC-канал, справочник, миграция, ограничение |
| [docs/import-export.md](./docs/import-export.md) | импорт из Excel, экспорт, печать |
| [docs/domain-glossary.md](./docs/domain-glossary.md) | предметная область: кредиты, подгруппы, потоки, клинические базы, замены |
| [docs/windows-install.md](./docs/windows-install.md) | установка на Windows, SmartScreen |

Предметная область неочевидна из кода: прежде чем менять поведение, сверяться с
[решениями](./docs/decisions.md) и с глоссарием.

## Команды

```
npm run dev             # Electron + hot reload
npm run typecheck       # три изолированных tsconfig: node / web / solver
npm run lint
npm test                # все тесты; один файл: npm test -- tests/db/repo.test.ts
npm run test:solver
npm run bench:solver    # порог качества солвера; падает с кодом 1, если не выдержан
npm run db:generate     # после правки схемы; SQL из drizzle/ коммитится
npm run build:mac       # .app без инсталлятора
npm run build:win       # NSIS .exe
```

**Только через `npm run …`.** `better-sqlite3` собран под ABI Electron и падает сегфолтом под
голым `node`, поэтому `vitest`/`tsx` запускаются через `scripts/electron-node.mjs`
(`ELECTRON_RUN_AS_NODE=1`). Детали и обходные пути — в
[dev-workflow.md](./docs/dev-workflow.md).

## Границы, которые нельзя нарушать

1. **Renderer не формулирует бизнес-правило** — он спрашивает main. Единственное исключение:
   импорт чистого `src/solver/validate.ts` для оптимистичной подсветки конфликтов при
   перетаскивании; авторитетная проверка перед записью идёт в main тем же кодом.
2. **`src/solver/` не знает про Electron, Node и БД.** Изоляция держится на трёх барьерах
   (tsconfig, ESLint, `tests/solver/isolation.test.ts`). Мост с доменом — только
   `services/snapshot.ts` и `services/apply-solution.ts`.
3. **`src/shared/` не зависит от `src/main/`** — типы справочников в `contract.ts`
   продублированы руками намеренно.
4. **Любая запись в БД — через `db/repo/base-repo.ts`** (`createRow`/`updateRow`/`closeRow`):
   иначе теряются `row_version`, `change_log` и снимок для отката. Массовые изменения — внутри
   `runOperation`.
5. **Ошибки не летят наружу**: `ipc/register.ts::handle()` заворачивает всё в `Result`, а
   `toAppError` переводит доменные исключения в коды с русским текстом. Новый тип ошибки
   обязан получить там ветку, иначе схлопнется в `INTERNAL_ERROR`.
6. **IPC-контракт** (`shared/ipc/contract.ts` + `schemas.ts`) — единственный источник типов
   для обеих сторон; расхождение с хендлером — ошибка компиляции.

## Мелочи, экономящие время

- Пустые директории-заглушки из первоначальной раскладки проекта (`src/main/audit/`,
  `src/main/backup/`, `src/main/db/repositories/`, `src/shared/domain/`,
  `src/renderer/src/components/ui/`, `src/renderer/src/print/`, `samples/`) — кода там нет,
  реальный живёт в `db/repo/`, `db/backup/`, `renderer/src/ui/`.
- Образцы xlsx, по которым разбиралась предметная область, в репозитории не лежат: они были
  **не** боевыми данными и не спецификацией формата (решения п. 17, 47), импорт сознательно
  format-agnostic. Структура образцов зафиксирована в фикстурах `tests/import/`.
- Перед сдачей: `npm run typecheck && npm run lint && npm test`, плюс `npm run bench:solver`,
  если трогал `src/solver/**` или `services/snapshot.ts`.
- `/commit` (`.claude/commands/commit.md`) — разложить текущие изменения по смыслу,
  закоммитить каждую группу отдельно и запушить текущую ветку.
