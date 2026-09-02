import type { Db } from '../client'
import { teacherCategory } from '../schema/people'

const DEFAULT_CATEGORIES: { code: 'staff' | 'external' | 'hourly'; titleRu: string; normHoursYear: number | null }[] = [
  { code: 'staff', titleRu: 'Штатный', normHoursYear: 720 },
  { code: 'external', titleRu: 'Внешний совместитель', normHoursYear: null },
  { code: 'hourly', titleRu: 'Почасовик', normHoursYear: null },
]

/**
 * Фиксированный набор категорий преподавателей (§4.3, ровно три по типу schema.$type):
 * заводится один раз при старте, идемпотентно — дальше только titleRu/normHoursYear
 * можно поправить вручную в БД, сам набор кодов CRUD-ом не редактируется.
 */
export function ensureTeacherCategories(db: Db): void {
  for (const category of DEFAULT_CATEGORIES) {
    db.insert(teacherCategory).values(category).onConflictDoNothing({ target: teacherCategory.code }).run()
  }
}
