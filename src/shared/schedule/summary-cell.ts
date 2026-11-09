import type { TemplateEntryView } from '../ipc/contract'

/**
 * Текст ячейки сводного расписания колледжа (решение 49, шаблон завуча от 06.11.2026):
 * верхняя строка — дисциплина, нижняя — преподаватель.
 *
 * - занятие группы или потока — «Дисциплина» (поток помечает вызывающая сторона);
 * - занятия подгрупп в одной паре — через «/»: слева первая подгруппа, справа вторая
 *   («Кырг. яз. / Ин. яз.»); пустая сторона оставляет «/» («Ист. КР /», «/ Лат. яз.»);
 * - клиническое занятие подгруппы пишется с римским номером и тоже стоит на своей стороне:
 *   I — слева, II и III — справа («I ЗОЖ /», «/ II ЗОЖ», «Лат. яз. / II ЗОЖ», «А. и Ф. / III ОСД»);
 * - преподаватели снизу — в том же порядке через «/» без пробелов («Абыкеева А./Омуралиева А.»),
 *   а если занятие только у одной стороны — просто фамилия, без «/» (как в шаблоне).
 *
 * Чистая функция без обращений к БД: сторону и признак «клиническое» уже вычислил main
 * (границы 1 и 3), здесь только сборка строки — её же использует экспорт в Excel и разбирает
 * обратно `main/import/grid/cell.ts`.
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
  const sided: SummaryCellEntry[] = []

  for (const e of entries) {
    if (e.subgroupSide == null) plain.push(e)
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

  if (sided.length > 0) {
    const numberOf = (e: SummaryCellEntry) => e.attendees.find((a) => a.groupId === groupId)?.subgroupNo ?? e.attendees[0]?.subgroupNo ?? null
    // Клиническая бригада встаёт на сторону по номеру: в шаблоне «I ЗОЖ /», но «/ II ЗОЖ» и «/ III ОСД».
    const sideOf = (e: SummaryCellEntry): 'left' | 'right' | 'third' => (e.isClinicalSubgroup ? ((numberOf(e) ?? 1) <= 1 ? 'left' : 'right') : e.subgroupSide!)
    const labelOf = (e: SummaryCellEntry) => {
      const no = numberOf(e)
      return e.isClinicalSubgroup && no != null ? `${ROMAN[no] ?? no} ${e.disciplineShortName}` : e.disciplineShortName
    }
    const bySide = [...sided].sort((a, b) => SIDE_ORDER[sideOf(a)] - SIDE_ORDER[sideOf(b)] || (numberOf(a) ?? 0) - (numberOf(b) ?? 0))
    // Две стороны — «a / b», три — «a / b / c»: формат образца третью часть не знает (вопрос Н2).
    const sides = (['left', 'right', 'third'] as const).slice(0, bySide.some((e) => sideOf(e) === 'third') ? 3 : 2)
    const tops = sides.map((side) => bySide.filter((e) => sideOf(e) === side).map(labelOf).join(', '))
    const bottoms = sides.map((side) => bySide.filter((e) => sideOf(e) === side).map((e) => teacherShortName(e.teacherName)).join(', '))
    const filled = bottoms.filter((b) => b !== '')
    parts.push({
      top: tops.join(' / ').trim(),
      bottom: filled.length === 1 ? filled[0]! : bottoms.join('/'),
      entryIds: bySide.map((e) => e.id),
      isStream: false,
    })
  }

  return parts
}
