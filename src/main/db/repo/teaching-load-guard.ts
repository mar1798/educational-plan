import { and, eq, sql } from 'drizzle-orm'
import { curriculumRow } from '../schema/curriculum'
import { teachingLoad } from '../schema/load'
import type { DbLike } from './types'

/**
 * Сколько строк нагрузки уже назначено на пару преподаватель+дисциплина (§2.3: закрытие
 * квалификации не блокируется, а предупреждает о затронутой нагрузке). Нагрузка появится
 * только в этапе 3 — до тех пор функция всегда вернёт 0, что корректно и ожидаемо.
 */
export function countAffectedLoad(tx: DbLike, teacherId: number, disciplineId: number): number {
  const row = tx
    .select({ n: sql<number>`count(*)` })
    .from(teachingLoad)
    .innerJoin(curriculumRow, eq(teachingLoad.curriculumRowId, curriculumRow.id))
    .where(and(eq(teachingLoad.teacherId, teacherId), eq(curriculumRow.disciplineId, disciplineId)))
    .get() as { n: number }
  return row.n
}
