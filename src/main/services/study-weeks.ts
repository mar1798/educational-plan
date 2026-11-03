/**
 * Учебные недели семестра (§этап В). Учебная неделя — календарная неделя Пн–Сб внутри семестра,
 * в которой есть хотя бы один учебный день (`study` или `moved_workday`). Недели целиком на
 * каникулах или праздниках номера не получают и в счёт не идут.
 *
 * День без записи в `calendar_day` считается учебным (Пн–Сб) — так же поступает раскатка, иначе
 * номера недель расходились бы с реальной раскаткой на незаполненном календаре.
 */
import { and, eq, sql } from 'drizzle-orm'
import { NotFoundError } from '../db/repo/base-repo'
import type { DbLike } from '../db/repo/types'
import { calendarDay, semester } from '../db/schema/calendar'

export interface StudyWeek {
  /** Номер учебной недели, с 1. */
  no: number
  /** Понедельник этой недели, YYYY-MM-DD. */
  monday: string
}

function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

function mondayOf(date: string): string {
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay()
  return addDays(date, -((dow + 6) % 7))
}

export function studyWeeksOfSemester(tx: DbLike, semesterId: number): StudyWeek[] {
  const sem = tx.select().from(semester).where(eq(semester.id, semesterId)).get()
  if (!sem) throw new NotFoundError('semester', semesterId)

  const days = new Map(
    tx
      .select()
      .from(calendarDay)
      .where(and(sql`${calendarDay.date} >= ${sem.startsOn}`, sql`${calendarDay.date} <= ${sem.endsOn}`))
      .all()
      .map((d) => [d.date, d.kind]),
  )

  const weeks: StudyWeek[] = []
  for (let monday = mondayOf(sem.startsOn); monday <= sem.endsOn; monday = addDays(monday, 7)) {
    let hasStudyDay = false
    for (let i = 0; i < 6 && !hasStudyDay; i++) {
      const date = addDays(monday, i)
      if (date < sem.startsOn || date > sem.endsOn) continue
      const kind = days.get(date)
      hasStudyDay = kind == null || kind === 'study' || kind === 'moved_workday'
    }
    if (hasStudyDay) weeks.push({ no: weeks.length + 1, monday })
  }
  return weeks
}

/** Предупреждение, если календарь даёт не то число учебных недель, что записано в семестре. */
export function studyWeeksWarning(tx: DbLike, semesterId: number): string | null {
  const sem = tx.select().from(semester).where(eq(semester.id, semesterId)).get()
  if (!sem) throw new NotFoundError('semester', semesterId)
  const found = studyWeeksOfSemester(tx, semesterId).length
  if (found === sem.weeksCount) return null
  return `По календарю в семестре ${found} учебных недель, а в настройках семестра указано ${sem.weeksCount}. Проверьте праздники, каникулы и число недель.`
}
