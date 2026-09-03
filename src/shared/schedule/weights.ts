/**
 * Русские подписи и профили весов мягких критериев (§5.5, §6 этап 6 PLAN.md).
 * Подписи ползунков и их описания живут в БД (`constraint_weight.title_ru`/`description_ru`,
 * §1.4 п.29) и редактируются пользователем — этот файл им не дублирует. Здесь только то,
 * что БД не хранит: короткие подписи для разбора штрафа в отчёте генерации («окна у
 * студентов: 34, вклад 40 %») и именованные профили весов из задачи этапа 6.
 */
import { DEFAULT_WEIGHTS, WEIGHT_CODES, type Weights } from '../../solver/model'

export type WeightKey = keyof Weights

/** Краткая подпись критерия для разбора штрафа — не зависит от того, как пользователь переименовал ползунок в БД. */
export const WEIGHT_BREAKDOWN_LABEL: Record<WeightKey, string> = {
  studentGaps: 'окна у студентов',
  teacherGaps: 'окна у преподавателей',
  spread: 'дисциплина размазана по дню',
  difficultyEarly: 'сложные пары не в начале дня',
  clinicalGrouping: 'занятия на базе не сгруппированы',
  teacherPreference: 'нарушены пожелания преподавателей',
  latePair: 'поздние пары',
  clinicalBlockStart: 'поздний старт блока на базе',
  roomMissing: 'занятия без кабинета',
  teacherDays: 'лишние рабочие дни преподавателей',
}

export interface WeightProfile {
  code: string
  titleRu: string
  weights: Weights
}

/** Профили из задачи этапа 6 («минимум окон», «беречь преподавателей», «компактные дни») + сброс к дефолту. */
export const WEIGHT_PROFILES: WeightProfile[] = [
  {
    code: 'default',
    titleRu: 'По умолчанию',
    weights: DEFAULT_WEIGHTS,
  },
  {
    code: 'minimize_gaps',
    titleRu: 'Минимум окон',
    weights: { ...DEFAULT_WEIGHTS, studentGaps: 30, teacherGaps: 20, spread: 3, teacherDays: 1 },
  },
  {
    code: 'protect_teachers',
    titleRu: 'Беречь преподавателей',
    weights: { ...DEFAULT_WEIGHTS, teacherGaps: 25, teacherDays: 20, teacherPreference: 15, studentGaps: 6 },
  },
  {
    code: 'compact_days',
    titleRu: 'Компактные дни',
    weights: { ...DEFAULT_WEIGHTS, spread: 20, clinicalGrouping: 20, teacherDays: 15, studentGaps: 6, teacherGaps: 6 },
  },
]

export function weightKeyForCode(code: string): WeightKey | null {
  for (const key of Object.keys(WEIGHT_CODES) as WeightKey[]) if (WEIGHT_CODES[key] === code) return key
  return null
}
