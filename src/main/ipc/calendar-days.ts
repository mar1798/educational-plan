import type { CalendarDay } from '../../shared/ipc/contract'
import { calendarDaysGenerateInput, calendarDaysListInput, calendarDaySetKindInput } from '../../shared/ipc/schemas'
import type { Db } from '../db/client'
import { generateCalendarDays, listCalendarDays, setCalendarDayKind } from '../db/repo/calendar-day'
import { handle } from './register'

export function registerCalendarDaysHandlers(db: Db) {
  handle('calendarDays:list', calendarDaysListInput, ({ from, to }) => {
    return listCalendarDays(db, from, to) as unknown as CalendarDay[]
  })

  handle('calendarDays:generate', calendarDaysGenerateInput, ({ semesterId }) => {
    const generated = db.transaction((tx) => generateCalendarDays(tx, semesterId))
    return { generated }
  })

  handle('calendarDays:setKind', calendarDaySetKindInput, ({ date, rowVersion, kind, movedFromDate, note }) => {
    return db.transaction((tx) => {
      const { row, cancelledLessons } = setCalendarDayKind(
        tx,
        { date, rowVersion, kind, movedFromDate, note },
        { reason: 'правка дня календаря' },
      )
      return { day: row as unknown as CalendarDay, cancelledLessons }
    })
  })
}
