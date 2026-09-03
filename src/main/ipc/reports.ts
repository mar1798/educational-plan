import { deductedHoursReport, roomUtilizationReport, teacherLoadReport } from '../db/repo/reports'
import { reportsDeductedHoursInput, reportsRoomUtilizationInput, reportsTeacherLoadInput } from '../../shared/ipc/schemas'
import type { Db } from '../db/client'
import { handle } from './register'

/** Отчёты этапа 7 PLAN.md: нагрузка (за учебный год), вычтенные часы и загрузка кабинетов (за диапазон дат). */
export function registerReportsHandlers(db: Db) {
  handle('reports:teacherLoad', reportsTeacherLoadInput, ({ academicYearId }) => {
    return teacherLoadReport(db, academicYearId)
  })

  handle('reports:deductedHours', reportsDeductedHoursInput, ({ dateFrom, dateTo }) => {
    return deductedHoursReport(db, dateFrom, dateTo)
  })

  handle('reports:roomUtilization', reportsRoomUtilizationInput, ({ dateFrom, dateTo }) => {
    return roomUtilizationReport(db, dateFrom, dateTo)
  })
}
