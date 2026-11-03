import type { TemplateEntryView } from '../ipc/contract'

/**
 * Текст ячейки сводного расписания колледжа (§этап А, разбор образца в PLAN-schedule-feedback.md):
 * верхняя строка — дисциплина, нижняя — преподаватель.
 *
 * - занятие группы или потока — «Дисциплина» (у потока в экранной версии добавляется пометка);
 * - клиническое занятие подгруппы — «II Терап.», без «/»;
 * - неклинические занятия подгрупп в одной паре — «Кырг. яз. / Ин. яз.»: слева первая подгруппа,
 *   справа вторая; пустая сторона оставляет «/» («Ист. КР /»), преподаватели — в том же порядке.
 *
 * Чистая функция без обращений к БД: сторону и признак «клиническое» уже вычислил main
 * (границы 1 и 3), здесь только сборка строки — её же использует экспорт в Excel.
 */
export interface SummaryCellPart {
  top: string
  bottom: string
  /** Записи, из которых собрана часть: клик по ней открывает конкретное занятие. */
  entryIds: number[]
  isStream: boolean
}

export type SummaryCellEntry = Pick<TemplateEntryView, 'id' | 'disciplineShortName' | 'teacherName' | 'subgroupSide' | 'isClinicalSubgroup' | 'attendees'>

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V']

const SIDE_ORDER = { left: 0, right: 1, third: 2 } as const

/** «Иванов Иван» → «Иванов И.»: в образце преподаватели подписаны фамилией с инициалом. */
export function teacherShortName(full: string): string {
  const [last, ...rest] = full.trim().split(/\s+/)
  const initials = rest.map((p) => `${p[0]}.`).join('')
  return initials ? `${last} ${initials}` : (last ?? full)
}

export function buildSummaryCell(entries: SummaryCellEntry[], groupId: number): SummaryCellPart[] {
  const parts: SummaryCellPart[] = []
  const plain: SummaryCellEntry[] = []
  const clinical: SummaryCellEntry[] = []
  const sided: SummaryCellEntry[] = []

  for (const e of entries) {
    if (e.subgroupSide == null) plain.push(e)
    else if (e.isClinicalSubgroup) clinical.push(e)
    else sided.push(e)
  }

  for (const e of plain) {
    parts.push({
      top: e.disciplineShortName,
      bottom: teacherShortName(e.teacherName),
      entryIds: [e.id],
      isStream: e.attendees.length > 1,
    })
  }

  const numberOf = (e: SummaryCellEntry) => e.attendees.find((a) => a.groupId === groupId)?.subgroupNo ?? e.attendees[0]?.subgroupNo ?? null
  for (const e of [...clinical].sort((a, b) => (numberOf(a) ?? 0) - (numberOf(b) ?? 0))) {
    const no = numberOf(e)
    const label = no != null ? `${ROMAN[no] ?? no} ` : ''
    parts.push({
      top: `${label}${e.disciplineShortName}`,
      bottom: teacherShortName(e.teacherName),
      entryIds: [e.id],
      isStream: false,
    })
  }

  if (sided.length > 0) {
    const bySide = [...sided].sort((a, b) => SIDE_ORDER[a.subgroupSide!] - SIDE_ORDER[b.subgroupSide!])
    // Две стороны — «a / b», три — «a / b / c»: формат образца третью часть не знает (вопрос Н2).
    const slots = bySide.some((e) => e.subgroupSide === 'third') ? 3 : 2
    const tops: string[] = []
    const bottoms: string[] = []
    const sides = ['left', 'right', 'third'] as const
    for (let i = 0; i < slots; i++) {
      const found = bySide.filter((e) => e.subgroupSide === sides[i])
      tops.push(found.map((e) => e.disciplineShortName).join(', '))
      bottoms.push(found.map((e) => teacherShortName(e.teacherName)).join(', '))
    }
    const trim = (xs: string[]) => xs.join(' / ').trimEnd()
    parts.push({
      top: trim(tops),
      bottom: trim(bottoms),
      entryIds: bySide.map((e) => e.id),
      isStream: false,
    })
  }

  return parts
}
