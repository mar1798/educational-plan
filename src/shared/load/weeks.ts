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

/**
 * Строка нагрузки для расстановки «сначала лекции, потом практика» (решение 53). `groupIds` —
 * группы, которые слушают строку: у потоковой лекции их несколько, а практика обычно у каждой
 * группы своя — сопоставлять теорию с практикой по «цели» (группа/поток) поэтому нельзя.
 */
export interface SequencedLoadInput extends LoadWeeksInput {
  curriculumRowId: number
  subgroupId?: number | null
}

/** Недели не заданы ни одним полем — программа вправе выбрать их сама. */
export function hasAutoWeeks(load: LoadWeeksInput): boolean {
  return load.weekFrom == null && load.weekTo == null && load.hoursPerWeek == null
}

function tryResolve(load: LoadWeeksInput, ctx: SemesterWeeksContext): ResolvedLoadWeeks | null {
  try {
    return resolveLoadWeeks(load, ctx)
  } catch {
    return null
  }
}

/**
 * Начало практики программа вправе выбрать сама, если человек не задал ни «с недели», ни «по неделю».
 * Заданные «часов в неделю» — это интенсивность, а не начало: такая практика тоже сдвигается.
 */
function hasMovableStart(load: LoadWeeksInput): boolean {
  return load.weekFrom == null && load.weekTo == null
}

/**
 * Недели по умолчанию с учётом правила «практика — после лекций» (решение 53, развивает п. 51).
 *
 * Прежний умолчательный режим растягивал лекции на весь семестр, а практику пускал с недели
 * практики: к её началу было пройдено 3/18 лекций, и солвер ставил практику, пока лекции шли
 * полным ходом. Теперь у пары «группа × строка плана», где есть и теория, и практика:
 *
 * - теория без заданных недель идёт с 1-й недели по T-ю, где T делит семестр пропорционально
 *   часам теории и практики — недельная нагрузка дисциплины остаётся примерно ровной;
 * - практика без заданного начала идёт со следующей недели после конца теории (но не раньше
 *   недели практики семестра);
 * - заданное человеком не трогается: явное начало практики задаёт конец теории, явная теория —
 *   начало практики. Если явная практика начинается раньше недели практики семестра, теорию не
 *   сжимаем в одну-две недели — оставляем как есть, и расхождение показывает `lecture-coverage`.
 *
 * Возвращает копии строк, где у сдвинутых заполнены недели, — дальше их читает обычный
 * `resolveLoadWeeks`. Порядок и прочие поля сохраняются.
 */
export function lectureFirstWeeks<T extends SequencedLoadInput>(loads: T[], groupsOf: (load: T) => number[], ctx: SemesterWeeksContext): T[] {
  const practiceFloor = ctx.practiceStartWeek ?? DEFAULT_PRACTICE_START_WEEK
  const n = ctx.weeksCount
  // Неделя практики за пределами семестра — ошибка настройки семестра; ничего не переставляем.
  if (practiceFloor > n) return loads

  const buckets = new Map<string, { theory: T[]; practice: T[] }>()
  for (const l of loads) {
    if (l.lessonKind !== 'theory' && l.lessonKind !== 'practice') continue
    for (const g of new Set(groupsOf(l))) {
      const key = `${g}:${l.curriculumRowId}`
      const b = buckets.get(key) ?? { theory: [], practice: [] }
      ;(l.lessonKind === 'theory' ? b.theory : b.practice).push(l)
      buckets.set(key, b)
    }
  }

  // Подгруппы одной дисциплины идут параллельно, а не друг за другом: к часам целой группы
  // прибавляется самая длинная подгруппа, а не сумма подгрупп.
  const hoursOf = (xs: T[]) => {
    const whole = xs.filter((l) => l.subgroupId == null).reduce((s, l) => s + l.hoursPlanned, 0)
    const sub = Math.max(0, ...xs.filter((l) => l.subgroupId != null).map((l) => l.hoursPlanned))
    return whole + sub
  }

  // Проход 1: конец автоматической теории. Потоковая лекция входит в корзину каждой группы —
  // берём самый РАННИЙ конец: практика каждой группы всё равно встаёт после фактического конца
  // лекции (проход 2), а самый поздний перекрывал бы явную практику одной из групп и сжимал
  // практику остальных.
  const theoryTo = new Map<T, number>()
  for (const b of buckets.values()) {
    if (b.theory.length === 0 || b.practice.length === 0) continue
    if (!b.theory.every(hasAutoWeeks)) continue
    const explicitStarts = b.practice.filter((l) => l.weekFrom != null).map((l) => l.weekFrom!)
    let end: number
    if (explicitStarts.length > 0) {
      end = Math.min(...explicitStarts) - 1
      if (end < practiceFloor - 1) continue // сжали бы лекции в 1–2 недели — оставляем, предупредит lecture-coverage
    } else {
      const ht = hoursOf(b.theory)
      const hp = hoursOf(b.practice)
      if (ht + hp <= 0) continue
      end = Math.min(n - 1, Math.max(practiceFloor - 1, Math.round((n * ht) / (ht + hp))))
    }
    for (const l of b.theory) theoryTo.set(l, Math.min(theoryTo.get(l) ?? Infinity, end))
  }

  // Проход 2: начало практики без заданного начала — после фактического конца теории группы.
  const practiceFrom = new Map<T, number>()
  for (const b of buckets.values()) {
    if (b.theory.length === 0 || b.practice.length === 0) continue
    const ends = b.theory.map((l) => theoryTo.get(l) ?? tryResolve(l, ctx)?.weekTo).filter((w): w is number => w != null)
    if (ends.length === 0) continue
    const start = Math.max(practiceFloor, Math.max(...ends) + 1)
    if (start > n) continue // лекции заняли весь семестр (заданы руками) — предупредит lecture-coverage
    for (const l of b.practice) {
      if (!hasMovableStart(l)) continue
      // С заданной интенсивностью практика должна уместиться до конца семестра — иначе не двигаем.
      if (l.hoursPerWeek != null && l.hoursPerWeek > 0 && start + Math.ceil(l.hoursPlanned / l.hoursPerWeek) - 1 > n) continue
      practiceFrom.set(l, Math.max(practiceFrom.get(l) ?? 0, start))
    }
  }

  return loads.map((l) => {
    const to = theoryTo.get(l)
    if (to != null) return { ...l, weekFrom: 1, weekTo: to }
    const from = practiceFrom.get(l)
    if (from != null) return { ...l, weekFrom: from }
    return l
  })
}
