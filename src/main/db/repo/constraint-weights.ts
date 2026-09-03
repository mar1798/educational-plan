/**
 * Веса мягких критериев солвера (§5.5, §6 этап 6 PLAN.md) — таблица `constraint_weight`,
 * заведённая ещё в этапе 1. Используются только строки с `semester_id IS NULL` («по умолчанию
 * для всех семестров», как задокументировано в схеме, §4.3 п.29): интерфейс этапа 6 —
 * один общий набор ползунков на всё приложение, без выбора семестра. Переопределение
 * по конкретному семестру схема допускает на будущее, но UI под него не строится.
 */
import { and, eq, isNull } from 'drizzle-orm'
import { DEFAULT_WEIGHTS, WEIGHT_CODES, type Weights } from '../../../solver/model'
import { constraintWeight } from '../schema/system'
import { nowIso, withAudit, type AuditContext } from './audit'
import { OptimisticLockError } from './base-repo'
import type { DbLike } from './types'

type WeightKey = keyof Weights

/** Человеческие подписи для ползунков (§6 этап 6: «Не любить окна у студентов» и т.п.). */
export const WEIGHT_TITLES_RU: Record<WeightKey, { title: string; description: string }> = {
  studentGaps: { title: 'Не любить окна у студентов', description: 'Штраф за пустые пары между занятиями одного дня у позиции студента' },
  teacherGaps: { title: 'Не любить окна у преподавателей', description: 'Штраф за пустые пары между занятиями одного дня у преподавателя' },
  spread: { title: 'Не размазывать дисциплину по дню', description: 'Штраф за второе и последующее занятие одной дисциплины у группы в один день' },
  difficultyEarly: { title: 'Сложные пары — пораньше', description: 'Штраф растёт, если сложная дисциплина стоит позже второй пары' },
  clinicalGrouping: { title: 'Группировать занятия на клинической базе', description: 'Штраф за лишние дни на клинической базе сверх минимально необходимых' },
  teacherPreference: { title: 'Уважать пожелания преподавателей', description: 'Штраф за постановку в слот с мягкой недоступностью преподавателя' },
  latePair: { title: 'Не любить поздние пары', description: 'Штраф за постановку занятия на 5–6 пару' },
  clinicalBlockStart: { title: 'Начинать блок на базе с первой пары', description: 'Штраф за сдвиг начала блока на клинической базе позже первой пары' },
  roomMissing: { title: 'Назначать кабинет', description: 'Штраф за занятие без назначенного кабинета там, где он не является жёстко обязательным' },
  teacherDays: { title: 'Беречь дни преподавателей', description: 'Штраф за рабочие дни преподавателя сверх минимально необходимых при его нагрузке' },
}

const DEFAULT_ROWS = (Object.keys(WEIGHT_CODES) as WeightKey[]).map((key) => ({
  code: WEIGHT_CODES[key] as ConstraintWeightRow['code'],
  weight: DEFAULT_WEIGHTS[key],
  titleRu: WEIGHT_TITLES_RU[key].title,
  descriptionRu: WEIGHT_TITLES_RU[key].description,
}))

type ConstraintWeightRow = typeof constraintWeight.$inferSelect

/** Заполняет отсутствующие строки значениями по умолчанию — не трогает уже существующие (пользователь мог их поправить). */
export function ensureConstraintWeights(db: DbLike): void {
  const existing = db
    .select({ code: constraintWeight.code })
    .from(constraintWeight)
    .where(isNull(constraintWeight.semesterId))
    .all() as { code: string }[]
  const existingCodes = new Set(existing.map((r) => r.code))
  for (const row of DEFAULT_ROWS) {
    if (existingCodes.has(row.code)) continue
    db.insert(constraintWeight)
      .values({ code: row.code, weight: row.weight, enabled: true, semesterId: null, titleRu: row.titleRu, descriptionRu: row.descriptionRu })
      .run()
  }
}

/** Собирает `Weights` для солвера (§5.5) — выключенный критерий (`enabled=false`) равносилен весу 0. */
export function loadWeights(db: DbLike): Weights {
  const rows = db.select().from(constraintWeight).where(isNull(constraintWeight.semesterId)).all() as ConstraintWeightRow[]
  const byCode = new Map(rows.map((r) => [r.code, r]))
  const result = { ...DEFAULT_WEIGHTS }
  for (const key of Object.keys(WEIGHT_CODES) as WeightKey[]) {
    const row = byCode.get(WEIGHT_CODES[key] as ConstraintWeightRow['code'])
    if (row) result[key] = row.enabled ? row.weight : 0
  }
  return result
}

export function listConstraintWeights(db: DbLike): ConstraintWeightRow[] {
  return db.select().from(constraintWeight).where(isNull(constraintWeight.semesterId)).all() as ConstraintWeightRow[]
}

export interface ConstraintWeightRowInput {
  id: number
  rowVersion: number
  weight: number
  enabled: boolean
}

export function updateConstraintWeightRow(tx: DbLike, input: ConstraintWeightRowInput, ctx: AuditContext = {}): ConstraintWeightRow {
  const before = tx
    .select()
    .from(constraintWeight)
    .where(and(eq(constraintWeight.id, input.id), isNull(constraintWeight.semesterId)))
    .get() as ConstraintWeightRow | undefined
  if (!before) throw new Error('Вес ограничения не найден')
  if (before.rowVersion !== input.rowVersion) throw new OptimisticLockError('constraint_weight', input.id)

  const updated = tx
    .update(constraintWeight)
    .set({ weight: input.weight, enabled: input.enabled, updatedAt: nowIso(), rowVersion: before.rowVersion + 1 })
    .where(eq(constraintWeight.id, input.id))
    .returning()
    .get() as ConstraintWeightRow

  withAudit(tx, 'constraint_weight', input.id, 'update', before, updated, ctx)
  return updated
}
