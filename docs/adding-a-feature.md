# Как добавить: канал, справочник, миграцию

Пошаговые рецепты со ссылками на существующие образцы. Общие правила слоёв —
[architecture.md](./architecture.md), правила записи в БД — [data-layer.md](./data-layer.md).

## Новый IPC-канал

1. **Контракт** — `src/shared/ipc/contract.ts`: строка вида
   `'домен:действие': { in: …; out: … }` в `IpcContract` (или в `IpcEvents`, если это
   одностороннее событие main → renderer). Типы данных описываются здесь же, руками —
   импортировать их из `main/db/schema` нельзя.
2. **Схема входа** — `src/shared/ipc/schemas.ts`: zod-объект. Для сущностей с оптимистичной
   блокировкой брать `withOptimisticId` + `.superRefine(requireRowVersionOnUpdate)`; для
   периодов — `requireOrderedRange`. Сообщения об ошибках писать по-русски: та же схема
   работает резолвером формы в renderer, и текст увидит пользователь.
3. **Хендлер** — `src/main/ipc/<домен>.ts`, внутри `register<Домен>Handlers(db, …)`:
   `handle('домен:действие', схемаВхода, (input) => …)`. Возвращать значение или бросать
   доменное исключение — `handle()` сам завернёт в `Result` и переведёт ошибку.
4. **Регистрация** — вызов `register…Handlers(db)` в `src/main/index.ts` (если файл новый).
5. **Renderer** — `api.invoke('домен:действие', input)`; тип входа и выхода выводится из
   контракта, отдельного клиента писать не нужно.

Расхождение контракта и хендлера — ошибка компиляции, поэтому `npm run typecheck` после
любой правки контракта обязателен.

Если хендлеру нужно окно (события, диалоги файлов, печать) — он принимает
`getWindow: () => BrowserWindow | null`, как `registerGenerationHandlers`. Не сохранять
`BrowserWindow` в замыкании: окно на macOS пересоздаётся по `activate`.

## Новый справочник (сущность с CRUD)

Образец от начала до конца — специальности: `schema/org.ts` → `ipc/specialities.ts` →
`features/specialities/SpecialitiesPage.tsx`.

1. Таблица в `src/main/db/schema/<тема>.ts` с `id()` и `...auditColumns`; `npm run db:generate`.
2. Три канала по обычному шаблону: `<домен>:list` (с флагом `includeArchived`/`includeClosed`),
   `<домен>:save` (создание и правка одним каналом: `id == null` → `createRow`, иначе
   `updateRow` с `rowVersion`), плюс закрывающее действие — `:archive`, `:close` или
   `:delete` с `ensureDeletable`.
3. Страница на `ReferenceCrudPage<TRow, TFormValues>`: `columns` (`@tanstack/react-table`),
   `resolver: zodResolver(<схема save>)`, `defaultValues`, `toFormValues`, `renderFields`
   из `ui/form/*Field`, `actions` (архивация/удаление с подтверждением). Тип значений формы —
   `z.infer<typeof <схема>SaveInput>`, отдельного интерфейса не заводить.
   Готовые возможности: `hasArchivedFilter`, `groupHeader` (группировка строк),
   `renderExtra` (вложенные панели — историчные связи; рендерятся вне `<form>`),
   `toolbarExtra`. История изменений подключается сама через `entityName` (канал `audit:entity`).
4. Роут в `app/router.tsx` + пункт меню в `app/nav.ts`.
5. Тест в `tests/db/` на правила уровня данных (не на UI).

Русские подписи общих действий — `ui/locale.ts::ruCommon`, тосты — `ui/toast.ts`.

## Новая таблица или колонка

См. [data-layer.md](./data-layer.md#миграции). Кратко: правка схемы → `npm run db:generate` →
коммит SQL и `meta/_journal.json`. Дополнительно:

- если на новую таблицу ссылается справочник — добавить проверку в `ensureDeletable`
  соответствующего `*:delete`;
- таблица попадает в `tableRegistry` автоматически (реестр строится из `schema/index.ts`),
  но только если она реэкспортирована из `schema/index.ts` — иначе `undoOperation` упадёт с
  «Неизвестная таблица в snapshot».

## Новое жёсткое или мягкое ограничение расписания

- Жёсткое: причина в `BlockReason` (`solver/model.ts`) → проверка в `hard.ts::canPlace` →
  зеркальная проверка в `validate.ts::validateSolution` (**самостоятельным кодом**, см.
  [solver.md](./solver.md#validatets--намеренное-дублирование)) → тест в `tests/solver/hard.test.ts`.
  Если ограничение видно и на материализованных записях — ещё и в `findConflicts` + русский
  текст в `shared/schedule/messages.ts`.
- Мягкое: поле в `Weights` → `DEFAULT_WEIGHTS` → `WEIGHT_CODES` → учёт в `penalty.ts` и в
  дельте `localSearch.ts` → сид в `ensureConstraintWeights` → тест в `penalty.test.ts`.
  После — `npm run bench:solver`.

## Новый тип доменной ошибки

Класс-исключение рядом с кодом, который его бросает (`db/repo/*.ts`), и **обязательно** ветка
в `ipc/register.ts::toAppError` с кодом и русским текстом. Без этого ошибка схлопнется в
`INTERNAL_ERROR`, и UI не сможет предложить осмысленное действие.

## Чек-лист перед сдачей

```
npm run typecheck && npm run lint && npm test
```

Плюс `npm run bench:solver`, если трогал `src/solver/**` или `services/snapshot.ts`.
