import { asc, eq } from 'drizzle-orm'
import type { AcademicYear } from '../../shared/ipc/contract'
import { academicYearDeleteInput, academicYearSaveInput, academicYearsListInput } from '../../shared/ipc/schemas'
import type { Db } from '../db/client'
import { createRow, deleteRow, updateRow } from '../db/repo/base-repo'
import { ensureDeletable } from '../db/repo/reference-guard'
import { academicYear, semester } from '../db/schema'
import { handle } from './register'

export function registerAcademicYearsHandlers(db: Db) {
  handle('academicYears:list', academicYearsListInput, () => {
    return db.select().from(academicYear).orderBy(asc(academicYear.startsOn)).all() as unknown as AcademicYear[]
  })

  handle('academicYears:save', academicYearSaveInput, ({ id, rowVersion, ...values }) => {
    const row =
      id != null
        ? updateRow(db, academicYear, id, values, rowVersion!, { reason: 'правка учебного года' })
        : createRow(db, academicYear, values, { reason: 'создание учебного года' })
    return row as unknown as AcademicYear
  })

  handle('academicYears:delete', academicYearDeleteInput, ({ id }) => {
    const existing = db.select().from(academicYear).where(eq(academicYear.id, id)).get()
    const label = `Учебный год «${existing?.name ?? id}»`
    db.transaction((tx) => {
      ensureDeletable(tx, label, id, [{ table: semester, column: semester.academicYearId, nounRu: 'семестрах' }])
      deleteRow(tx, academicYear, id, { reason: 'удаление учебного года' })
    })
    return { ok: true as const }
  })
}
