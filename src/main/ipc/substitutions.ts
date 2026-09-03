import {
  applyCancelLesson,
  applyMoveLesson,
  applyTeacherSwap,
  listTeacherLessons,
  listTeacherSubstitutionHistory,
  rankSubstituteCandidates,
} from '../db/repo/substitution'
import { runOperation } from '../db/repo/operations'
import {
  substitutionsCancelInput,
  substitutionsCandidatesInput,
  substitutionsMoveInput,
  substitutionsSwapInput,
  substitutionsTeacherHistoryInput,
  substitutionsTeacherLessonsInput,
} from '../../shared/ipc/schemas'
import type { Db } from '../db/client'
import { handle } from './register'

/** Мастер замены (§этап 7 PLAN.md): подбор преподавателя, отмена, перенос — каждое действие своя операция kind='substitution' (§1.5). */
export function registerSubstitutionsHandlers(db: Db) {
  handle('substitutions:teacherLessons', substitutionsTeacherLessonsInput, ({ teacherId, dateFrom, dateTo }) => {
    return listTeacherLessons(db, teacherId, dateFrom, dateTo)
  })

  handle('substitutions:candidates', substitutionsCandidatesInput, ({ lessonId }) => {
    return rankSubstituteCandidates(db, lessonId)
  })

  handle('substitutions:swap', substitutionsSwapInput, ({ lessonId, substituteTeacherId, reason }) => {
    const { operationId } = runOperation(db, 'substitution', { lessonId, substituteTeacherId }, (tx, opId) =>
      applyTeacherSwap(tx, { lessonId, substituteTeacherId, reason }, { operationId: opId, reason: reason ?? 'замена преподавателя' }),
    )
    return { operationId }
  })

  handle('substitutions:cancel', substitutionsCancelInput, ({ lessonId, reason }) => {
    const { operationId } = runOperation(db, 'substitution', { lessonId }, (tx, opId) =>
      applyCancelLesson(tx, { lessonId, reason }, { operationId: opId, reason: reason ?? 'отмена занятия' }),
    )
    return { operationId }
  })

  handle('substitutions:move', substitutionsMoveInput, ({ lessonId, newDate, newPairNo, newRoomId, reason }) => {
    const { operationId } = runOperation(db, 'substitution', { lessonId, newDate, newPairNo }, (tx, opId) =>
      applyMoveLesson(tx, { lessonId, newDate, newPairNo, newRoomId, reason }, { operationId: opId, reason: reason ?? 'перенос занятия' }),
    )
    return { operationId }
  })

  handle('substitutions:teacherHistory', substitutionsTeacherHistoryInput, ({ teacherId }) => {
    return listTeacherSubstitutionHistory(db, teacherId)
  })
}
