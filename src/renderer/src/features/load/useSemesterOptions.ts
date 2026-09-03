import { useEffect, useMemo, useState } from 'react'
import type { AcademicYear, Semester } from '../../../../shared/ipc/contract'
import { api } from '../../api/client'

/** Общий список семестров с человекочитаемой подписью — используется на всех экранах нагрузки (§3.5–3.7). */
export function useSemesterOptions() {
  const [academicYears, setAcademicYears] = useState<AcademicYear[]>([])
  const [semesters, setSemesters] = useState<Semester[]>([])

  useEffect(() => {
    void api.invoke('academicYears:list', {}).then((res) => {
      if (res.ok) setAcademicYears(res.value)
    })
    void api.invoke('semesters:list', {}).then((res) => {
      if (res.ok) setSemesters(res.value)
    })
  }, [])

  const yearNameById = useMemo(() => new Map(academicYears.map((y) => [y.id, y.name])), [academicYears])
  const label = (id: number) => {
    const sem = semesters.find((s) => s.id === id)
    if (!sem) return `#${id}`
    return `${yearNameById.get(sem.academicYearId) ?? sem.academicYearId}, ${sem.no}-й семестр`
  }

  return { semesters, academicYears, label }
}
