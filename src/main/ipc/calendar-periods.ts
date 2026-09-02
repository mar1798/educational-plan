import { asc } from 'drizzle-orm'
import type { CalendarPeriod } from '../../shared/ipc/contract'
import { calendarPeriodDeleteInput, calendarPeriodSaveInput, calendarPeriodsListInput } from '../../shared/ipc/schemas'
import type { Db } from '../db/client'
import { createRow, deleteRow, updateRow } from '../db/repo/base-repo'
import { calendarPeriod } from '../db/schema/calendar'
import { handle } from './register'

export function registerCalendarPeriodsHandlers(db: Db) {
  handle('calendarPeriods:list', calendarPeriodsListInput, () => {
    return db.select().from(calendarPeriod).orderBy(asc(calendarPeriod.startsOn)).all() as unknown as CalendarPeriod[]
  })

  handle('calendarPeriods:save', calendarPeriodSaveInput, ({ id, rowVersion, ...values }) => {
    const row =
      id != null
        ? updateRow(db, calendarPeriod, id, values, rowVersion!, { reason: 'правка периода календаря' })
        : createRow(db, calendarPeriod, values, { reason: 'создание периода календаря' })
    return row as unknown as CalendarPeriod
  })

  handle('calendarPeriods:delete', calendarPeriodDeleteInput, ({ id }) => {
    db.transaction((tx) => deleteRow(tx, calendarPeriod, id, { reason: 'удаление периода календаря' }))
    return { ok: true as const }
  })
}
