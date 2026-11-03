/**
 * Разбор ячейки сводного расписания колледжа (§этап Ж, обозначения — решения п. 49).
 * Чистая функция без обращений к БД: верхняя строка — дисциплина, нижняя — преподаватель.
 *
 * - верхняя строка делится по `/` на стороны (слева 1-я подгруппа, справа 2-я), с каждой стороны
 *   снимается римский номер подгруппы (`I`, `II`, `III`), остаток — сокращение дисциплины;
 * - нижняя строка делится по `/` на преподавателей в том же порядке;
 * - без `/` и с номером («II Терап.») — клиническое занятие этой подгруппы; без `/` и без номера —
 *   занятие всей группы или потока;
 * - несколько занятий в одной паре, записанные через `;` (так их пишет выгрузка этапа Б), разбираются
 *   каждое по этим правилам.
 */

export interface ParsedSide {
  /** Сокращение дисциплины как записано в ячейке. */
  discipline: string
  /** «Фамилия И.» как записано в ячейке; null — преподаватель не указан. */
  teacher: string | null
  /** Номер подгруппы: явный римский или по стороне от `/`; null — вся группа. */
  subgroupNo: number | null
  /** Клиническое занятие подгруппы (номер без `/`). */
  clinical: boolean
}

export interface ParsedCell {
  sides: ParsedSide[]
  /** Нижняя строка не совпала с верхней по числу сторон — преподаватель мог встать не на своё место. */
  teacherMismatch: boolean
}

const ROMAN: Record<string, number> = { I: 1, II: 2, III: 3, IV: 4 }
const ROMAN_PREFIX = /^(IV|III|II|I)(?=\s|$)\s*/

function split(text: string, sep: string): string[] {
  return text.split(sep).map((p) => p.trim())
}

/** Снимает римский номер подгруппы с начала стороны. */
function takeSubgroup(side: string): { no: number | null; rest: string } {
  const m = ROMAN_PREFIX.exec(side)
  return m ? { no: ROMAN[m[1]!]!, rest: side.slice(m[0].length).trim() } : { no: null, rest: side }
}

function parsePart(top: string, bottom: string): { sides: ParsedSide[]; mismatch: boolean } {
  const tops = split(top, '/')
  const bottoms = bottom === '' ? [] : split(bottom, '/')
  const slashed = tops.length > 1

  const sides: ParsedSide[] = []
  tops.forEach((raw, i) => {
    if (raw === '') return // пустая сторона: занятие только у другой подгруппы
    const { no, rest } = takeSubgroup(raw)
    if (rest === '') return
    sides.push({
      discipline: rest,
      teacher: bottoms.length === tops.length ? bottoms[i] || null : bottoms.length === 1 && !slashed ? bottoms[0]! : null,
      subgroupNo: slashed ? (no ?? i + 1) : no,
      clinical: !slashed && no != null,
    })
  })
  return { sides, mismatch: slashed && bottoms.length > 0 && bottoms.length !== tops.length }
}

export function parseCell(top: string | null, bottom: string | null): ParsedCell {
  const topText = (top ?? '').replace(/\s+/g, ' ').trim()
  const bottomText = (bottom ?? '').replace(/\s+/g, ' ').trim()
  if (topText === '') return { sides: [], teacherMismatch: false }

  const topParts = split(topText, ';').filter((p) => p !== '')
  const bottomParts = bottomText === '' ? [] : split(bottomText, ';')
  const sides: ParsedSide[] = []
  let mismatch = bottomParts.length > 0 && bottomParts.length !== topParts.length
  topParts.forEach((part, i) => {
    const r = parsePart(part, bottomParts.length === topParts.length ? bottomParts[i]! : topParts.length === 1 ? bottomText : '')
    sides.push(...r.sides)
    mismatch ||= r.mismatch
  })
  return { sides, teacherMismatch: mismatch }
}

/** «Иванов И.» → { lastName, initial }. Без инициала — только фамилия. */
export function parseTeacherName(text: string): { lastName: string; initial: string | null } {
  const [last = '', ...rest] = text.trim().split(/\s+/)
  const first = rest.join('').replace(/\./g, '')
  return { lastName: last, initial: first === '' ? null : first[0]!.toLowerCase() }
}
