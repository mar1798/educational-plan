import { asc } from 'drizzle-orm'
import type { TeacherCategory } from '../../shared/ipc/contract'
import { teacherCategoriesListInput } from '../../shared/ipc/schemas'
import type { Db } from '../db/client'
import { teacherCategory } from '../db/schema'
import { handle } from './register'

export function registerTeacherCategoriesHandlers(db: Db) {
  handle('teacherCategories:list', teacherCategoriesListInput, () => {
    return db.select().from(teacherCategory).orderBy(asc(teacherCategory.id)).all() as unknown as TeacherCategory[]
  })
}
