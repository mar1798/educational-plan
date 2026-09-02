import { useCallback, useEffect, useMemo, useState } from 'react'
import type { AcademicYear, CalendarDay, Semester } from '../../../../shared/ipc/contract'
import { api } from '../../api/client'
import { EntityHistoryPanel } from '../../ui/EntityHistoryPanel'
import { WEEKDAY_LABEL, ruCommon } from '../../ui/locale'
import { notifyError, notifySuccess } from '../../ui/toast'

const KIND_LABEL: Record<CalendarDay['kind'], string> = {
  study: 'Учебный день',
  weekend: 'Выходной',
  holiday: 'Праздник',
  vacation: 'Каникулы',
  moved_workday: 'Перенесённый рабочий день',
}

const MONTH_LABEL = [
  'Январь',
  'Февраль',
  'Март',
  'Апрель',
  'Май',
  'Июнь',
  'Июль',
  'Август',
  'Сентябрь',
  'Октябрь',
  'Ноябрь',
  'Декабрь',
]

interface MonthKey {
  year: number
  month: number // 0..11
}

function monthsBetween(from: string, to: string): MonthKey[] {
  const start = new Date(`${from}T00:00:00Z`)
  const end = new Date(`${to}T00:00:00Z`)
  const months: MonthKey[] = []
  let year = start.getUTCFullYear()
  let month = start.getUTCMonth()
  while (year < end.getUTCFullYear() || (year === end.getUTCFullYear() && month <= end.getUTCMonth())) {
    months.push({ year, month })
    month++
    if (month > 11) {
      month = 0
      year++
    }
  }
  return months
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

function isoDate(year: number, month: number, day: number): string {
  return `${year}-${pad2(month + 1)}-${pad2(day)}`
}

/** 0 = Пн … 6 = Вс, чтобы совпадать с недельной сеткой занятий (§2, §4.4: Пн–Сб рабочие). */
function mondayFirstWeekday(year: number, month: number, day: number): number {
  const jsDay = new Date(Date.UTC(year, month, day)).getUTCDay()
  return (jsDay + 6) % 7
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
}

const KIND_CLASS: Record<CalendarDay['kind'], string> = {
  study: 'day-cell-study',
  weekend: 'day-cell-weekend',
  holiday: 'day-cell-holiday',
  vacation: 'day-cell-vacation',
  moved_workday: 'day-cell-moved',
}

/**
 * Календарь года сеткой (§2.8): дни материализуются генерацией по семестру, дальше правятся
 * вручную. Отметить праздник — один клик по значку в углу ячейки; остальное (каникулы, перенос,
 * примечание) — через панель выбранного дня ниже, там же видна история правок (§2.10).
 */
export function CalendarYearPage() {
  const [years, setYears] = useState<AcademicYear[]>([])
  const [yearId, setYearId] = useState<number | ''>('')
  const [semesters, setSemesters] = useState<Semester[]>([])
  const [days, setDays] = useState<Record<string, CalendarDay>>({})
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [detailKind, setDetailKind] = useState<CalendarDay['kind']>('study')
  const [detailMovedFrom, setDetailMovedFrom] = useState('')
  const [detailNote, setDetailNote] = useState('')

  useEffect(() => {
    void api.invoke('academicYears:list', {}).then((res) => {
      if (res.ok) {
        setYears(res.value)
        if (res.value[0]) setYearId(res.value[0].id)
      }
    })
  }, [])

  const year = years.find((y) => y.id === yearId) ?? null

  const refreshDays = useCallback(() => {
    if (!year) return
    void api.invoke('calendarDays:list', { from: year.startsOn, to: year.endsOn }).then((res) => {
      if (res.ok) setDays(Object.fromEntries(res.value.map((d) => [d.date, d])))
      else notifyError(res.error.message)
    })
  }, [year])

  useEffect(() => {
    if (yearId === '') return
    void api.invoke('semesters:list', { academicYearId: yearId }).then((res) => {
      if (res.ok) setSemesters(res.value)
    })
  }, [yearId])

  useEffect(() => {
    refreshDays()
  }, [refreshDays])

  const months = useMemo(() => (year ? monthsBetween(year.startsOn, year.endsOn) : []), [year])

  const selectedDay = selectedDate ? days[selectedDate] : undefined

  function selectDate(date: string) {
    setSelectedDate(date)
    const d = days[date]
    setDetailKind(d?.kind ?? 'study')
    setDetailMovedFrom(d?.movedFromDate ?? '')
    setDetailNote(d?.note ?? '')
  }

  async function generateForSemester(semesterId: number) {
    const res = await api.invoke('calendarDays:generate', { semesterId })
    if (res.ok) {
      notifySuccess(`Сгенерировано дней: ${res.value.generated}`)
      refreshDays()
    } else {
      notifyError(res.error.message)
    }
  }

  async function toggleHoliday(day: CalendarDay) {
    const isSunday = new Date(`${day.date}T00:00:00Z`).getUTCDay() === 0
    const nextKind: CalendarDay['kind'] = day.kind === 'holiday' ? (isSunday ? 'weekend' : 'study') : 'holiday'
    const res = await api.invoke('calendarDays:setKind', { date: day.date, rowVersion: day.rowVersion, kind: nextKind })
    if (res.ok) {
      notifySuccess(res.value.cancelledLessons > 0 ? `${KIND_LABEL[nextKind]}. Отменено занятий: ${res.value.cancelledLessons}` : KIND_LABEL[nextKind])
      refreshDays()
    } else {
      notifyError(res.error.message)
    }
  }

  async function saveDetail() {
    if (!selectedDate || !selectedDay) return
    const res = await api.invoke('calendarDays:setKind', {
      date: selectedDate,
      rowVersion: selectedDay.rowVersion,
      kind: detailKind,
      movedFromDate: detailKind === 'moved_workday' ? (detailMovedFrom || null) : null,
      note: detailNote || null,
    })
    if (res.ok) {
      notifySuccess(res.value.cancelledLessons > 0 ? `${ruCommon.savedOk}. Отменено занятий: ${res.value.cancelledLessons}` : ruCommon.savedOk)
      refreshDays()
    } else {
      notifyError(res.error.message)
    }
  }

  return (
    <div>
      <div className="page-header">
        <h2>Календарь</h2>
        <div className="toolbar-actions">
          <select value={yearId} onChange={(e) => setYearId(e.target.value === '' ? '' : Number(e.target.value))}>
            {years.map((y) => (
              <option key={y.id} value={y.id}>
                {y.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {year && (
        <div className="page-toolbar">
          {semesters.map((s) => (
            <button key={s.id} type="button" className="btn" onClick={() => void generateForSemester(s.id)}>
              Сгенерировать дни: {s.no}-й семестр ({s.startsOn} – {s.endsOn})
            </button>
          ))}
        </div>
      )}

      {!year && <p className="history-empty">Сначала заведите учебный год на странице «Учебные годы»</p>}

      {year && (
        <div className="year-calendar">
          {months.map(({ year: y, month }) => (
            <div className="month-block" key={`${y}-${month}`}>
              <h3>
                {MONTH_LABEL[month]} {y}
              </h3>
              <div className="month-grid">
                {Object.values(WEEKDAY_LABEL).map((label) => (
                  <div className="month-grid-weekday" key={label}>
                    {label.slice(0, 2)}
                  </div>
                ))}
                <div className="month-grid-weekday">Вс</div>
                {Array.from({ length: mondayFirstWeekday(y, month, 1) }).map((_, i) => (
                  <div key={`pad-${i}`} />
                ))}
                {Array.from({ length: daysInMonth(y, month) }).map((_, i) => {
                  const day = i + 1
                  const date = isoDate(y, month, day)
                  const info = days[date]
                  const cls = info ? KIND_CLASS[info.kind] : 'day-cell-missing'
                  return (
                    <div
                      key={date}
                      className={`day-cell ${cls} ${selectedDate === date ? 'day-cell-selected' : ''}`}
                      onClick={() => selectDate(date)}
                      title={info ? KIND_LABEL[info.kind] : 'День ещё не сгенерирован'}
                    >
                      <span>{day}</span>
                      {info && (
                        <button
                          type="button"
                          className="day-cell-holiday-toggle"
                          title="Отметить/снять праздник — один клик"
                          onClick={(e) => {
                            e.stopPropagation()
                            void toggleHoliday(info)
                          }}
                        >
                          {info.kind === 'holiday' ? '×' : '!'}
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {selectedDate && (
        <div className="card">
          <h3>День {selectedDate}</h3>
          {!selectedDay && <p className="history-empty">День ещё не сгенерирован — сначала сгенерируйте дни семестра выше</p>}
          {selectedDay && (
            <>
              <div className="form-field">
                <label>Тип дня</label>
                <select value={detailKind} onChange={(e) => setDetailKind(e.target.value as CalendarDay['kind'])}>
                  {Object.entries(KIND_LABEL).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
              {detailKind === 'moved_workday' && (
                <div className="form-field">
                  <label>Перенесено с даты</label>
                  <input type="date" value={detailMovedFrom} onChange={(e) => setDetailMovedFrom(e.target.value)} />
                </div>
              )}
              <div className="form-field">
                <label>Примечание</label>
                <input type="text" value={detailNote} onChange={(e) => setDetailNote(e.target.value)} />
              </div>
              <button type="button" className="btn btn-primary" onClick={() => void saveDetail()}>
                {ruCommon.save}
              </button>
              <EntityHistoryPanel entity="calendar_day" id={Math.floor(Date.parse(`${selectedDate}T00:00:00Z`) / 86_400_000)} />
            </>
          )}
        </div>
      )}
    </div>
  )
}
