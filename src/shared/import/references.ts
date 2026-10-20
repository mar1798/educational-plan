/**
 * Справочные знания, которые нужны, чтобы завести недостающие записи из файла нагрузки:
 * какая специальность за кодом в имени группы, как разобрать «КСД-21» и «Янхаева З.».
 * Чистые функции без БД — их использует main (preflight импорта) и тесты.
 */

/** Шесть специальностей колледжа (решения п. 45) и срок обучения (п. 42). */
export const SPECIALITY_CATALOG: { code: string; name: string; semestersTotal: number }[] = [
  { code: 'СД', name: 'Сестринское дело', semestersTotal: 6 },
  { code: 'ЛД', name: 'Лечебное дело', semestersTotal: 7 },
  { code: 'АД', name: 'Акушерское дело', semestersTotal: 6 },
  { code: 'Л', name: 'Лабораторная диагностика', semestersTotal: 6 },
  { code: 'СО', name: 'Зубной техник', semestersTotal: 6 },
  { code: 'Ф', name: 'Фармация', semestersTotal: 6 },
]

export interface ParsedGroupName {
  funding: 'budget' | 'contract'
  specialityCode: string
  course: number
}

/**
 * «КСД-22» → контракт, Сестринское дело, 2 курс (решения п. 41). Код ищется по списку
 * известных кодов, а не по первым двум буквам: бывает однобуквенный «Л-31» (п. 45), а «К»
 * перед кодом — признак контракта, если без неё остаётся известный код.
 */
export function parseGroupName(name: string, specialityCodes: string[]): ParsedGroupName | null {
  const m = /^\s*([А-ЯЁA-Z]+)\s*-?\s*(\d)(\d+)\s*$/i.exec(name)
  if (!m) return null
  const prefix = m[1]!.toUpperCase()
  const course = Number(m[2])
  if (course < 1) return null
  const known = new Set(specialityCodes.map((c) => c.toUpperCase()))
  if (known.has(prefix)) return { funding: 'budget', specialityCode: prefix, course }
  if (prefix.startsWith('К') && known.has(prefix.slice(1))) return { funding: 'contract', specialityCode: prefix.slice(1), course }
  return null
}

export interface PersonNameParts {
  lastName: string
  firstName: string
  middleName: string | null
}

const PARTICLES: Record<string, string> = { 'к.': 'кызы', кызы: 'кызы', 'у.': 'уулу', уулу: 'уулу' }

/**
 * ФИО как его пишут в нагрузке: «Янхаева З.», «Абдуллаева М.Н», «Омуркул к. К.». Инициал
 * сохраняется с точкой — завуч сразу видит, что имя заведено из файла и его стоит дописать.
 * Сравнение с такими записями (matchesPersonName) понимает и полное имя, и инициал.
 */
export function splitPersonName(text: string): PersonNameParts | null {
  const parts = text.trim().split(/\s+/).filter((p) => p !== '')
  let surname = parts.slice(0, 1)
  let rest = parts.slice(1)
  const particle = PARTICLES[(parts[1] ?? '').toLowerCase()]
  if (particle && parts.length >= 3) {
    surname = [parts[0]!, particle]
    rest = parts.slice(2)
  }
  if (surname.length === 0 || rest.length === 0) return null

  const initials = (token: string) =>
    token
      .split('.')
      .filter((p) => p !== '')
      .map((p) => `${p.charAt(0).toUpperCase()}.`)
  const given = rest[0]!
  if (given.includes('.') || given.length === 1) {
    const [first, middle] = initials(given)
    return { lastName: surname.join(' '), firstName: first!, middleName: middle ?? (rest[1] ? initials(rest[1])[0]! : null) }
  }
  return { lastName: surname.join(' '), firstName: given, middleName: rest[1] ?? null }
}
