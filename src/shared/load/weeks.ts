/**
 * Недели действия нагрузки и «часов в неделю» (§этап В). Чистая функция: нужна и main
 * (проверка лимита, генерация), и подсказке в диалоге нагрузки — расходиться им нельзя.
 *
 * Номера недель — учебные (1..weeksCount), а не календарные: каникулы номера не получают
 * (`main/services/study-weeks.ts`).
 */

/** Неделя начала практики по умолчанию (ответ завуча: 4-я, одна для всех групп). */
export const DEFAULT_PRACTICE_START_WEEK = 4

export interface LoadWeeksInput {
  lessonKind: 'theory' | 'practice' | 'seminar' | 'lab'
  hoursPlanned: number
  weekFrom?: number | null
  weekTo?: number | null
  hoursPerWeek?: number | null
}

export interface SemesterWeeksContext {
  weeksCount: number
  practiceStartWeek: number | null
}

export interface ResolvedLoadWeeks {
  weekFrom: number
  weekTo: number
  weeksCount: number
  /** Заданная вручную интенсивность или средняя по диапазону. */
  hoursPerWeek: number
  /** true — `hoursPerWeek` задал человек, а не посчитала программа. */
  manual: boolean
  /** Часы, которые реально лягут на недели диапазона (при ручной интенсивности могут не совпасть с планом). */
  scheduledHours: number
  warnings: string[]
}

/** Ошибка ввода недель — переводится в понятное сообщение, а не в INTERNAL_ERROR. */
export class LoadWeeksError extends Error {}

export function resolveLoadWeeks(load: LoadWeeksInput, ctx: SemesterWeeksContext): ResolvedLoadWeeks {
  const defaultFrom = load.lessonKind === 'practice' ? (ctx.practiceStartWeek ?? DEFAULT_PRACTICE_START_WEEK) : 1
  const weekFrom = load.weekFrom ?? defaultFrom
  const hpw = load.hoursPerWeek ?? null

  if (hpw != null && hpw <= 0) throw new LoadWeeksError('Часов в неделю должно быть больше нуля')
  if (weekFrom < 1) throw new LoadWeeksError('Неделя начала не может быть меньше 1')

  const weekTo = load.weekTo ?? (hpw != null ? weekFrom + Math.ceil(load.hoursPlanned / hpw) - 1 : ctx.weeksCount)

  if (weekTo > ctx.weeksCount) {
    throw new LoadWeeksError(`Последняя неделя ${weekTo} выходит за пределы семестра (${ctx.weeksCount} учебных недель)`)
  }
  if (weekFrom > weekTo) {
    throw new LoadWeeksError(`Неделя начала (${weekFrom}) позже недели окончания (${weekTo})`)
  }

  const weeksCount = weekTo - weekFrom + 1
  const warnings: string[] = []

  if (hpw == null) {
    return { weekFrom, weekTo, weeksCount, hoursPerWeek: load.hoursPlanned / weeksCount, manual: false, scheduledHours: load.hoursPlanned, warnings }
  }

  const scheduledHours = hpw * weeksCount
  if (load.weekTo != null && scheduledHours !== load.hoursPlanned) {
    warnings.push(`${hpw} ч/нед × ${weeksCount} нед. = ${scheduledHours} ч, а по плану ${load.hoursPlanned} ч`)
  }
  return { weekFrom, weekTo, weeksCount, hoursPerWeek: hpw, manual: true, scheduledHours: load.weekTo != null ? scheduledHours : load.hoursPlanned, warnings }
}

/** Часы нагрузки в конкретной учебной неделе; последняя неделя при ручной интенсивности может быть неполной. */
export function hoursInWeek(load: LoadWeeksInput, resolved: ResolvedLoadWeeks, week: number): number {
  if (week < resolved.weekFrom || week > resolved.weekTo) return 0
  if (!resolved.manual) return resolved.hoursPerWeek
  const left = load.hoursPlanned - resolved.hoursPerWeek * (week - resolved.weekFrom)
  return Math.max(0, Math.min(resolved.hoursPerWeek, left))
}

/** «нед. 1–5, 8 ч/нед, итого 40 ч из 36 — последняя неделя неполная» — строка под полями диалога. */
export function describeLoadWeeks(load: LoadWeeksInput, resolved: ResolvedLoadWeeks): string {
  const range = resolved.weekFrom === resolved.weekTo ? `нед. ${resolved.weekFrom}` : `нед. ${resolved.weekFrom}–${resolved.weekTo}`
  const rate = Number.isInteger(resolved.hoursPerWeek) ? String(resolved.hoursPerWeek) : resolved.hoursPerWeek.toFixed(1)
  let text = `${range}, ${rate} ч/нед`
  if (resolved.manual) {
    const total = resolved.hoursPerWeek * resolved.weeksCount
    text += `, итого ${total} ч из ${load.hoursPlanned}`
    if (total > load.hoursPlanned) text += ' — последняя неделя неполная'
    else if (total < load.hoursPlanned) text += ' — часов не хватает'
  }
  return text
}
