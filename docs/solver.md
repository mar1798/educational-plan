# Солвер расписания

Здесь — устройство кода солвера и его инварианты.

## Изоляция

`src/solver/` — чистый TypeScript: никакого Electron, Node, БД, DOM. На вход JSON-совместимый
`SolverInput` с **числовыми индексами**, на выход `SolverOutput`. Держится тремя барьерами
(`tsconfig.solver.json` без `types`/DOM, ESLint `no-restricted-imports`,
`tests/solver/isolation.test.ts`). Ломать нельзя: на этом стоит и скорость тестов, и
возможность заменить движок, не трогая приложение.

Мост с доменом — ровно два файла:

- `src/main/services/snapshot.ts` — `buildSolverInput(tx, templateId, seed)`: справочники,
  нагрузка семестра и сетка пар → индексы; уже стоящие `is_locked=1` записи шаблона → `fixed`
  (препятствия, солвер их не двигает); недостающие часы нагрузки → `units` по формуле §5.2;
- `src/main/services/apply-solution.ts` — обратно: новая версия шаблона, locked-записи
  переносятся как есть, остальные из `output.assignments`, всё внутри
  `runOperation('generate', …)`, поэтому откат работает без отдельного кода.

## Модули

| Файл | Роль |
|---|---|
| `model.ts` | типы, константы `DAYS=6`, `PAIRS=6`, `SLOTS=36`, `POSITIONS=64`, `Weights` и `DEFAULT_WEIGHTS`, `WEIGHT_CODES` (единственное место сопоставления camelCase ↔ `constraint_weight.code`) |
| `occupancy.ts` | битовые маски `BitMask64` (два 32-битных слова: 36 слотов и до 64 позиций студентов) и изменяемое состояние `Solution` |
| `hard.ts` | `canPlace(...)` — короткозамкнутая проверка одной попытки, возвращает первую нарушенную `BlockReason` или `null`; `candidateRooms`, `allowsNoRoom`. Не мутирует состояние |
| `penalty.ts` | функция штрафа §5.5: 10 мягких критериев в «сырых» единицах + взвешенная сумма; `UNPLACED_PENALTY = 1000` за каждый неразмещённый юнит (вне весов, не настраивается) |
| `greedy.ts` | фаза 1: most-constrained-first, локальная эвристика при выборе (slot, room); неудачный юнит уходит в `unplaced` с самой частой причиной, алгоритм продолжает |
| `localSearch.ts` | фаза 2: имитация отжига, ходы `move`/`swap`/`rechair`/`insert`, прирост штрафа считается **дельтой по затронутому фрагменту** (группа+день, преподаватель+день), а не пересчётом решения |
| `rng.ts` | mulberry32 — детерминизм по seed |
| `validate.ts` | независимый арбитр, см. ниже |
| `index.ts` | `solve()` = greedy → localSearch в оставшийся бюджет; асинхронна |

`solve()` асинхронна не ради удобства: `localSearch` периодически отдаёт event loop, иначе
`isCancelled()` и сообщение `cancel` от главного процесса не обрабатывались бы до конца
расчёта, и отмена генерации не работала бы.

## `validate.ts` — намеренное дублирование

Файл делится на два слоя, которые **не переиспользуют код друг друга**:

- `findConflicts` — уровень материализованных записей шаблона (преподаватель / кабинет /
  пересечение подгрупп). Используется в renderer при перетаскивании (оптимистичная подсветка)
  и в main как авторитетная проверка перед записью — один и тот же код в обоих местах;
- `validateSolution` — уровень солвера (`Unit`/`Assignment`), пересчитывает занятость с нуля
  собственным кодом, отдельным от `occupancy.ts`/`hard.ts`. Если бы валидатор звал те же
  функции, что и `greedy.ts`, общая ошибка в них осталась бы незамеченной. **Не «оптимизировать»
  это дублирование.**

Русские тексты конфликтов — `src/shared/schedule/messages.ts` (`describeConflict`).

## Веса

`Weights` (10 полей) редактируются пользователем на экране «Веса ограничений», хранятся в
таблице `constraint_weight` в snake_case и грузятся `repo/constraint-weights.ts::loadWeights`.
Добавляя мягкое ограничение: поле в `Weights` → значение в `DEFAULT_WEIGHTS` → строка в
`WEIGHT_CODES` → учёт в `penalty.ts` (и в дельте `localSearch.ts`) → сид в `ensureConstraintWeights`.

## Пороги качества

- `tests/solver/golden.test.ts` — регрессия: фиксированный seed, стоп по `maxIterations`
  (не по времени, чтобы результат не зависел от скорости машины), порог `penalty < golden + 5%`.
- `npm run bench:solver` (`tests/solver/bench.ts`, отдельная джоба CI) на наборе
  `full-college`: жадная фаза < 3000 мс и **ноль** нарушений валидатора; жадная + поиск в
  бюджете 60 с — падение штрафа минимум на 40 %. Скрипт сам выходит с кодом 1.
- Прочее: `hard.test.ts`, `penalty.test.ts`, `invariants.test.ts`, `paired-units.test.ts`,
  `room-fixed.test.ts`, `localSearch.test.ts`, `isolation.test.ts`.

Меняя `penalty.ts` или `localSearch.ts`, гонять `npm run test:solver` **и**
`npm run bench:solver` — golden-порог ловит ухудшение, которого юнит-тесты не видят.

## Причины отказа

`BlockReason` (почему конкретная попытка не прошла): `slot_disabled`, `teacher_unavailable`,
`teacher_busy`, `student_busy`, `room_busy`, `room_capacity`, `room_type`, `room_fixed`,
`building_mismatch`, `group_day_limit`, `teacher_day_limit`, `group_week_hours`,
`clinical_conflict`, `no_room_candidate`.

`UnplacedReason` (почему юнит не встал вовсе): `no_free_slot`, `no_suitable_room`,
`teacher_unavailable`, `group_day_limit`, `paired_unit_failed`.

`StopReason`: `completed`, `time_budget`, `max_iterations`, `no_improvement`, `cancelled`.
