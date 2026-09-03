/**
 * Генератор демо-колледжа (§9.2 набор `full-college`, приёмка §10): наполняет БД
 * реалистичным медколледжем — 6 специальностей, 39 групп (12 бюджет + 27 контракт),
 * ~140 преподавателей трёх категорий, здания с клиническими базами, учебные планы,
 * схемы деления, потоки и нагрузку на осенний семестр.
 *
 * Запуск: `npm run seed:demo [-- <путь к .db>] [--force]`
 *
 * Без аргумента пишет в ту же БД, которую открывает `npm run dev`
 * (`<userData>/educational-plan/data/college.db`), чтобы демо-колледж сразу был виден
 * в приложении. Если БД уже содержит данные, скрипт останавливается: перезапись — только
 * по явному `--force`, и тогда прежний файл сначала копируется рядом с меткой времени.
 *
 * Данные детерминированы (один и тот же seed → тот же колледж), и всё, что можно, пишется
 * через боевые репозитории (`saveTeachingLoad`, `createDivisionScheme`, `createStream`),
 * а не прямыми INSERT — так генератор заодно проверяет, что правила этапов 2–3 выполнимы.
 */
import { copyFileSync, existsSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { createDb, type Db } from '../src/main/db/client'
import { runMigrations } from '../src/main/db/migrate'
import { createRow, updateRow } from '../src/main/db/repo/base-repo'
import { generateCalendarDays, setCalendarDayKind } from '../src/main/db/repo/calendar-day'
import { createCurriculumRow } from '../src/main/db/repo/curriculum'
import { createDivisionScheme } from '../src/main/db/repo/division-scheme'
import { ensurePairGrid } from '../src/main/db/repo/pair-grid'
import { createTemplate } from '../src/main/db/repo/schedule-template'
import { ensureTeacherCategories } from '../src/main/db/repo/seed'
import { createStream } from '../src/main/db/repo/stream'
import { saveTeachingLoad } from '../src/main/db/repo/teaching-load'
import * as schema from '../src/main/db/schema'
import { Rng } from '../src/solver/rng'

const SEED = 20260901
const ADMISSION_BASE = 2026
const VALID_FROM = '2026-08-01'

// ─────────────────────────────────────────────────────────────────────────────────────────
// Куда писать

/** Тот же путь, что вычисляет Electron в dev-режиме: `app.getPath('userData')` + data/. */
function defaultDbPath(): string {
  const name = 'educational-plan' // package.json "name" — под ним Electron заводит userData
  if (process.platform === 'darwin') return join(homedir(), 'Library', 'Application Support', name, 'data', 'college.db')
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming')
    return join(appData, name, 'data', 'college.db')
  }
  const configHome = process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config')
  return join(configHome, name, 'data', 'college.db')
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// Справочные данные (фиксированные списки — генератор детерминирован)

const SPECIALITIES = [
  { code: 'СД', name: 'Сестринское дело', qualification: 'Медицинская сестра / медицинский брат', semestersTotal: 8 },
  { code: 'ЛД', name: 'Лечебное дело', qualification: 'Фельдшер', semestersTotal: 8 },
  { code: 'АД', name: 'Акушерское дело', qualification: 'Акушерка / акушер', semestersTotal: 6 },
  { code: 'Л', name: 'Лабораторная диагностика', qualification: 'Медицинский лабораторный техник', semestersTotal: 6 },
  { code: 'СО', name: 'Стоматология ортопедическая', qualification: 'Зубной техник', semestersTotal: 6 },
  { code: 'Ф', name: 'Фармация', qualification: 'Фармацевт', semestersTotal: 6 },
] as const

type SpecialityCode = (typeof SPECIALITIES)[number]['code']

const CMCS = [
  'ЦМК общегуманитарных дисциплин',
  'ЦМК общепрофессиональных дисциплин',
  'ЦМК сестринского дела',
  'ЦМК клинических дисциплин',
  'ЦМК лабораторной диагностики и фармации',
  'ЦМК стоматологических дисциплин',
]

type RoomType = 'lecture' | 'practice' | 'seminar' | 'lab' | 'phantom' | 'computer' | 'gym'

interface DisciplineSpec {
  name: string
  indexCode: string
  block: 1 | 2 | 3
  cycle: 'spo1' | 'spo2' | 'spo3' | 'spo4' | 'spo5'
  part: 'base' | 'elective'
  difficulty: number
  roomType: RoomType
  requiresClinical: boolean
  cmc: number // индекс в CMCS
}

/** Дисциплины колледжа: имя → блок/цикл/часть/сложность/тип кабинета (§2.7). */
const DISCIPLINES: DisciplineSpec[] = [
  { name: 'Кыргызский язык', indexCode: 'ОГСЭ.01', block: 1, cycle: 'spo1', part: 'base', difficulty: 2, roomType: 'seminar', requiresClinical: false, cmc: 0 },
  { name: 'Русский язык', indexCode: 'ОГСЭ.02', block: 1, cycle: 'spo1', part: 'base', difficulty: 2, roomType: 'seminar', requiresClinical: false, cmc: 0 },
  { name: 'Иностранный язык', indexCode: 'ОГСЭ.03', block: 1, cycle: 'spo1', part: 'base', difficulty: 2, roomType: 'seminar', requiresClinical: false, cmc: 0 },
  { name: 'История', indexCode: 'ОГСЭ.04', block: 1, cycle: 'spo1', part: 'base', difficulty: 1, roomType: 'lecture', requiresClinical: false, cmc: 0 },
  { name: 'Физическая культура', indexCode: 'ОГСЭ.05', block: 1, cycle: 'spo1', part: 'base', difficulty: 1, roomType: 'gym', requiresClinical: false, cmc: 0 },
  { name: 'Информатика', indexCode: 'ЕН.01', block: 1, cycle: 'spo2', part: 'base', difficulty: 2, roomType: 'computer', requiresClinical: false, cmc: 1 },
  { name: 'Математика', indexCode: 'ЕН.02', block: 1, cycle: 'spo2', part: 'base', difficulty: 3, roomType: 'lecture', requiresClinical: false, cmc: 1 },
  { name: 'Анатомия и физиология человека', indexCode: 'ОП.01', block: 2, cycle: 'spo3', part: 'base', difficulty: 5, roomType: 'lecture', requiresClinical: false, cmc: 1 },
  { name: 'Основы патологии', indexCode: 'ОП.02', block: 2, cycle: 'spo3', part: 'base', difficulty: 4, roomType: 'lecture', requiresClinical: false, cmc: 1 },
  { name: 'Генетика человека', indexCode: 'ОП.03', block: 2, cycle: 'spo3', part: 'base', difficulty: 4, roomType: 'lecture', requiresClinical: false, cmc: 1 },
  { name: 'Гигиена и экология человека', indexCode: 'ОП.04', block: 2, cycle: 'spo3', part: 'base', difficulty: 3, roomType: 'lecture', requiresClinical: false, cmc: 1 },
  { name: 'Основы микробиологии и иммунологии', indexCode: 'ОП.05', block: 2, cycle: 'spo3', part: 'base', difficulty: 4, roomType: 'lab', requiresClinical: false, cmc: 1 },
  { name: 'Фармакология', indexCode: 'ОП.06', block: 2, cycle: 'spo3', part: 'base', difficulty: 5, roomType: 'lecture', requiresClinical: false, cmc: 4 },
  { name: 'Психология общения', indexCode: 'ОП.07', block: 2, cycle: 'spo3', part: 'base', difficulty: 2, roomType: 'seminar', requiresClinical: false, cmc: 0 },
  { name: 'Основы латинского языка', indexCode: 'ОП.08', block: 2, cycle: 'spo3', part: 'base', difficulty: 3, roomType: 'seminar', requiresClinical: false, cmc: 0 },
  { name: 'Безопасность жизнедеятельности', indexCode: 'ОП.09', block: 2, cycle: 'spo3', part: 'base', difficulty: 2, roomType: 'lecture', requiresClinical: false, cmc: 1 },
  { name: 'Теория сестринского дела', indexCode: 'ПМ.01', block: 3, cycle: 'spo4', part: 'base', difficulty: 4, roomType: 'practice', requiresClinical: true, cmc: 2 },
  { name: 'Сестринский уход в терапии', indexCode: 'ПМ.02', block: 3, cycle: 'spo4', part: 'base', difficulty: 5, roomType: 'practice', requiresClinical: true, cmc: 2 },
  { name: 'Сестринский уход в хирургии', indexCode: 'ПМ.03', block: 3, cycle: 'spo4', part: 'base', difficulty: 5, roomType: 'practice', requiresClinical: true, cmc: 2 },
  { name: 'Сестринский уход в педиатрии', indexCode: 'ПМ.04', block: 3, cycle: 'spo4', part: 'base', difficulty: 4, roomType: 'practice', requiresClinical: true, cmc: 2 },
  { name: 'Неотложная помощь на догоспитальном этапе', indexCode: 'ПМ.05', block: 3, cycle: 'spo4', part: 'base', difficulty: 5, roomType: 'phantom', requiresClinical: true, cmc: 3 },
  { name: 'Диагностика в терапии', indexCode: 'ПМ.06', block: 3, cycle: 'spo4', part: 'base', difficulty: 5, roomType: 'practice', requiresClinical: true, cmc: 3 },
  { name: 'Физиологическое акушерство', indexCode: 'ПМ.07', block: 3, cycle: 'spo4', part: 'base', difficulty: 5, roomType: 'phantom', requiresClinical: true, cmc: 3 },
  { name: 'Клинические лабораторные исследования', indexCode: 'ПМ.08', block: 3, cycle: 'spo4', part: 'base', difficulty: 5, roomType: 'lab', requiresClinical: true, cmc: 4 },
  { name: 'Технология изготовления протезов', indexCode: 'ПМ.09', block: 3, cycle: 'spo4', part: 'base', difficulty: 5, roomType: 'lab', requiresClinical: false, cmc: 5 },
  { name: 'Технология изготовления лекарственных форм', indexCode: 'ПМ.10', block: 3, cycle: 'spo4', part: 'base', difficulty: 4, roomType: 'lab', requiresClinical: false, cmc: 4 },
  { name: 'Организация деятельности аптеки', indexCode: 'ПМ.11', block: 3, cycle: 'spo5', part: 'base', difficulty: 3, roomType: 'practice', requiresClinical: true, cmc: 4 },
  { name: 'Основы реабилитации', indexCode: 'ПМ.12', block: 3, cycle: 'spo5', part: 'elective', difficulty: 3, roomType: 'practice', requiresClinical: true, cmc: 2 },
]

/**
 * Учебный план специальности: по 8 дисциплин на семестр — 6 теоретических (по одной
 * строке нагрузки) и 2 практических (делятся на подгруппы, по строке нагрузки на каждую).
 * Итого 10 строк нагрузки на группу и 30 кредитов в семестре (§3.1).
 */
const PLAN_BY_SPECIALITY: Record<SpecialityCode, { theory: string[]; practice: string[] }[]> = {
  СД: [
    { theory: ['Кыргызский язык', 'Иностранный язык', 'История', 'Анатомия и физиология человека', 'Основы латинского языка', 'Информатика'], practice: ['Физическая культура', 'Теория сестринского дела'] },
    { theory: ['Русский язык', 'Основы патологии', 'Гигиена и экология человека', 'Фармакология', 'Психология общения', 'Математика'], practice: ['Основы микробиологии и иммунологии', 'Сестринский уход в терапии'] },
    { theory: ['Иностранный язык', 'Генетика человека', 'Фармакология', 'Безопасность жизнедеятельности', 'Психология общения', 'История'], practice: ['Сестринский уход в хирургии', 'Сестринский уход в педиатрии'] },
    { theory: ['Основы патологии', 'Анатомия и физиология человека', 'Гигиена и экология человека', 'Безопасность жизнедеятельности', 'Математика', 'Информатика'], practice: ['Основы реабилитации', 'Сестринский уход в терапии'] },
  ],
  ЛД: [
    { theory: ['Кыргызский язык', 'Иностранный язык', 'Анатомия и физиология человека', 'Основы латинского языка', 'Информатика', 'История'], practice: ['Физическая культура', 'Неотложная помощь на догоспитальном этапе'] },
    { theory: ['Русский язык', 'Основы патологии', 'Фармакология', 'Гигиена и экология человека', 'Математика', 'Психология общения'], practice: ['Основы микробиологии и иммунологии', 'Диагностика в терапии'] },
    { theory: ['Иностранный язык', 'Генетика человека', 'Фармакология', 'Безопасность жизнедеятельности', 'История', 'Психология общения'], practice: ['Неотложная помощь на догоспитальном этапе', 'Диагностика в терапии'] },
    { theory: ['Анатомия и физиология человека', 'Основы патологии', 'Гигиена и экология человека', 'Безопасность жизнедеятельности', 'Информатика', 'Математика'], practice: ['Основы реабилитации', 'Диагностика в терапии'] },
  ],
  АД: [
    { theory: ['Кыргызский язык', 'Иностранный язык', 'Анатомия и физиология человека', 'Основы латинского языка', 'История', 'Информатика'], practice: ['Физическая культура', 'Теория сестринского дела'] },
    { theory: ['Русский язык', 'Основы патологии', 'Фармакология', 'Психология общения', 'Гигиена и экология человека', 'Математика'], practice: ['Основы микробиологии и иммунологии', 'Физиологическое акушерство'] },
    { theory: ['Иностранный язык', 'Генетика человека', 'Фармакология', 'Безопасность жизнедеятельности', 'Психология общения', 'История'], practice: ['Физиологическое акушерство', 'Сестринский уход в педиатрии'] },
  ],
  Л: [
    { theory: ['Кыргызский язык', 'Иностранный язык', 'Анатомия и физиология человека', 'Основы латинского языка', 'Информатика', 'Математика'], practice: ['Физическая культура', 'Основы микробиологии и иммунологии'] },
    { theory: ['Русский язык', 'Основы патологии', 'Гигиена и экология человека', 'Фармакология', 'История', 'Психология общения'], practice: ['Клинические лабораторные исследования', 'Основы микробиологии и иммунологии'] },
    { theory: ['Иностранный язык', 'Генетика человека', 'Безопасность жизнедеятельности', 'Фармакология', 'Математика', 'Информатика'], practice: ['Клинические лабораторные исследования', 'Основы реабилитации'] },
  ],
  СО: [
    { theory: ['Кыргызский язык', 'Иностранный язык', 'Анатомия и физиология человека', 'Основы латинского языка', 'Информатика', 'История'], practice: ['Физическая культура', 'Технология изготовления протезов'] },
    { theory: ['Русский язык', 'Основы патологии', 'Гигиена и экология человека', 'Математика', 'Психология общения', 'Фармакология'], practice: ['Технология изготовления протезов', 'Основы микробиологии и иммунологии'] },
    { theory: ['Иностранный язык', 'Генетика человека', 'Безопасность жизнедеятельности', 'История', 'Информатика', 'Психология общения'], practice: ['Технология изготовления протезов', 'Основы реабилитации'] },
  ],
  Ф: [
    { theory: ['Кыргызский язык', 'Иностранный язык', 'Основы латинского языка', 'Анатомия и физиология человека', 'Математика', 'Информатика'], practice: ['Физическая культура', 'Технология изготовления лекарственных форм'] },
    { theory: ['Русский язык', 'Основы патологии', 'Фармакология', 'Гигиена и экология человека', 'История', 'Психология общения'], practice: ['Технология изготовления лекарственных форм', 'Основы микробиологии и иммунологии'] },
    { theory: ['Иностранный язык', 'Генетика человека', 'Фармакология', 'Безопасность жизнедеятельности', 'Информатика', 'Математика'], practice: ['Организация деятельности аптеки', 'Технология изготовления лекарственных форм'] },
  ],
}

/** Сколько групп на каждом курсе специальности — в сумме 39 (§9.2 `full-college`). */
const GROUPS_PER_COURSE: Record<SpecialityCode, number[]> = {
  СД: [4, 3, 3, 2],
  ЛД: [3, 2, 2, 1],
  АД: [2, 2, 1],
  Л: [2, 1, 1],
  СО: [2, 1, 1],
  Ф: [3, 2, 1],
}

/** Кредиты по восьми строкам семестра: в сумме ровно 30 (§3.1). */
const CREDITS_PER_ROW = [4, 4, 4, 4, 4, 4, 3, 3]

const LAST_NAMES = [
  'Абдыкадырова', 'Асанов', 'Ахметова', 'Бакиров', 'Бекташева', 'Борисов', 'Валиева', 'Ганиева',
  'Дюшеев', 'Ермекова', 'Жумабаев', 'Зайцева', 'Иманалиев', 'Исакова', 'Кадырова', 'Калыков',
  'Ким', 'Кожомкулова', 'Кузнецова', 'Лебедев', 'Макарова', 'Мамытова', 'Мурзаев', 'Никитина',
  'Орозова', 'Осмонов', 'Панкратова', 'Раимбеков', 'Сагынбаева', 'Сатыбалдиев', 'Смирнова',
  'Сооронбаева', 'Ташиева', 'Токтогулов', 'Усенова', 'Федорова', 'Халилова', 'Чолпонбаев',
  'Шакирова', 'Эргешов', 'Юсупова', 'Ялалова',
]
const FIRST_NAMES_F = ['Айгуль', 'Алина', 'Бермет', 'Гульнара', 'Дина', 'Елена', 'Жылдыз', 'Зульфия', 'Ирина', 'Каныкей', 'Лариса', 'Мээрим', 'Назгуль', 'Ольга', 'Роза', 'Светлана', 'Тамара', 'Умут', 'Чинара', 'Эльмира']
const FIRST_NAMES_M = ['Азамат', 'Бакыт', 'Владимир', 'Данияр', 'Ержан', 'Заир', 'Ильяс', 'Каныбек', 'Максат', 'Нурлан', 'Олег', 'Пётр', 'Руслан', 'Сергей', 'Талант', 'Улан', 'Фарид', 'Чубак', 'Эркин', 'Юрий']
const PATRONYMICS_F = ['Абдыкадыровна', 'Асановна', 'Бакировна', 'Викторовна', 'Дюшеевна', 'Ивановна', 'Кадыровна', 'Мамытовна', 'Николаевна', 'Осмоновна', 'Петровна', 'Сергеевна', 'Токтогуловна', 'Урматовна']
const PATRONYMICS_M = ['Абдыкадырович', 'Асанович', 'Бакирович', 'Викторович', 'Дюшеевич', 'Иванович', 'Кадырович', 'Мамытович', 'Николаевич', 'Осмонович', 'Петрович', 'Сергеевич', 'Токтогулович', 'Урматович']

const WORKPLACES = ['Городская больница №1, терапия', 'Роддом №2, акушерство', 'КГМА, кафедра фармакологии', 'Поликлиника №4', 'Станция скорой помощи', null, null, null]

/** Праздники Кыргызской Республики, попадающие в учебный год 2026/2027 (§2.8 — правятся вручную). */
const HOLIDAYS: { date: string; note: string }[] = [
  { date: '2026-11-07', note: 'День истории и памяти предков' },
  { date: '2026-11-08', note: 'День истории и памяти предков' },
  { date: '2026-12-31', note: 'Канун Нового года' },
  { date: '2027-01-07', note: 'Рождество Христово' },
  { date: '2027-02-23', note: 'День защитника Отечества' },
  { date: '2027-03-08', note: 'Международный женский день' },
  { date: '2027-03-21', note: 'Нооруз' },
  { date: '2027-05-01', note: 'Праздник труда' },
  { date: '2027-05-05', note: 'День Конституции' },
  { date: '2027-05-09', note: 'День Победы' },
]

// ─────────────────────────────────────────────────────────────────────────────────────────

interface Counters {
  [key: string]: number
}

function seedDemo(db: Db): { counters: Counters; templateId: number; semesterId: number } {
  const rng = new Rng(SEED)
  const counters: Counters = {}
  const count = (key: string, n = 1) => {
    counters[key] = (counters[key] ?? 0) + n
  }

  ensureTeacherCategories(db)
  ensurePairGrid(db)

  const categoryIdByCode = new Map(
    db.select().from(schema.teacherCategory).all().map((c) => [c.code, c.id]),
  )

  // ── Специальности
  const specialityIdByCode = new Map<SpecialityCode, number>()
  for (const s of SPECIALITIES) {
    const row = createRow(db, schema.speciality, { code: s.code, name: s.name, qualification: s.qualification, semestersTotal: s.semestersTotal })
    specialityIdByCode.set(s.code, row.id as number)
    count('специальностей')
  }

  // ── Здания: учебный корпус + три клинические базы с разными режимами (§9.2 `clinical`)
  const buildings = [
    { name: 'Главный корпус', address: 'г. Бишкек, ул. Ахунбаева, 92', isClinical: false, clinicalMode: null },
    { name: 'Городская клиническая больница №1', address: 'г. Бишкек, ул. Фучика, 15', isClinical: true, clinicalMode: 'full_day' as const },
    { name: 'Родильный дом №2', address: 'г. Бишкек, ул. Тоголок Молдо, 3', isClinical: true, clinicalMode: 'block' as const },
    { name: 'Поликлиника №4', address: 'г. Бишкек, ул. Байтик Баатыра, 40', isClinical: true, clinicalMode: 'free' as const },
  ]
  const buildingIds = buildings.map((b) => {
    count('зданий')
    return createRow(db, schema.building, b).id as number
  })
  const [mainBuildingId, hospitalId, maternityId, polyclinicId] = buildingIds as [number, number, number, number]

  // ── Кабинеты: в главном корпусе — по типам с запасом, на базах — практика и фантомные
  const roomIdsByType = new Map<RoomType, number[]>()
  const addRoom = (buildingId: number, number: string, roomType: RoomType, capacity: number, name: string | null) => {
    const row = createRow(db, schema.room, { buildingId, number, name, capacity, roomType, validFrom: VALID_FROM })
    const list = roomIdsByType.get(roomType) ?? []
    list.push(row.id as number)
    roomIdsByType.set(roomType, list)
    count('кабинетов')
    return row.id as number
  }

  // Вместимость — не украшение: теоретическое занятие идёт на всю группу (до 32 человек),
  // поэтому лекционные, семинарские, компьютерные и лабораторные кабинеты рассчитаны на
  // полную группу, а практические — на подгруппу (§4.6). Кабинет меньше группы солвер
  // просто не сможет выбрать, и занятие уйдёт в «Не удалось разместить».
  addRoom(mainBuildingId, '101', 'lecture', 120, 'Актовый зал')
  addRoom(mainBuildingId, '102', 'lecture', 90, 'Большая лекционная')
  for (let i = 0; i < 18; i++) addRoom(mainBuildingId, `${201 + i}`, 'lecture', 40, null)
  for (let i = 0; i < 14; i++) addRoom(mainBuildingId, `${301 + i}`, 'practice', 20, null)
  for (let i = 0; i < 10; i++) addRoom(mainBuildingId, `${401 + i}`, 'seminar', 34, null)
  for (let i = 0; i < 6; i++) addRoom(mainBuildingId, `${501 + i}`, 'lab', 34, null)
  for (let i = 0; i < 5; i++) addRoom(mainBuildingId, `${601 + i}`, 'computer', 34, null)
  addRoom(mainBuildingId, 'СЗ-1', 'gym', 40, 'Спортивный зал')
  addRoom(mainBuildingId, 'СЗ-2', 'gym', 40, 'Малый спортзал')
  for (let i = 0; i < 4; i++) addRoom(mainBuildingId, `Ф-${i + 1}`, 'phantom', 16, 'Фантомный кабинет')

  // На каждой базе — весь набор типов, которые требуют клинические дисциплины: иначе
  // занятие с привязкой к зданию останется вообще без кандидатов на кабинет.
  const clinicalRooms: [number, string, string][] = [
    [hospitalId, 'ГКБ', 'ГКБ №1'],
    [maternityId, 'РД', 'роддома'],
    [polyclinicId, 'ПК', 'поликлиники'],
  ]
  for (const [buildingId, prefix, what] of clinicalRooms) {
    for (let i = 0; i < 4; i++) addRoom(buildingId, `${prefix}-${i + 1}`, 'practice', 16, `Учебная комната ${what}`)
    for (let i = 0; i < 2; i++) addRoom(buildingId, `${prefix}-Ф${i + 1}`, 'phantom', 16, `Фантомный кабинет ${what}`)
    for (let i = 0; i < 2; i++) addRoom(buildingId, `${prefix}-Л${i + 1}`, 'lab', 16, `Лаборатория ${what}`)
  }

  // ── ЦМК и дисциплины
  const cmcIds = CMCS.map((name) => {
    count('ЦМК')
    return createRow(db, schema.cmc, { name }).id as number
  })

  const disciplineIdByName = new Map<string, number>()
  for (const d of DISCIPLINES) {
    const row = createRow(db, schema.discipline, {
      name: d.name,
      indexCode: d.indexCode,
      block: d.block,
      cycle: d.cycle,
      part: d.part,
      difficulty: d.difficulty,
      defaultRoomType: d.roomType,
      requiresClinical: d.requiresClinical,
    })
    disciplineIdByName.set(d.name, row.id as number)
    count('дисциплин')
  }
  const disciplineSpecByName = new Map(DISCIPLINES.map((d) => [d.name, d]))

  // ── Преподаватели: 90 штатных, 30 внештатных, 20 почасовиков
  interface TeacherRec {
    id: number
    cmcIdx: number
  }
  const teachers: TeacherRec[] = []
  const composition: { code: 'staff' | 'external' | 'hourly'; n: number; maxHoursYear: number | null }[] = [
    { code: 'staff', n: 90, maxHoursYear: 900 },
    { code: 'external', n: 30, maxHoursYear: 500 },
    { code: 'hourly', n: 20, maxHoursYear: 300 },
  ]
  for (const { code, n, maxHoursYear } of composition) {
    for (let i = 0; i < n; i++) {
      const female = rng.nextInt(10) < 7 // в медколледже большинство преподавателей — женщины
      const lastName = rng.pick(LAST_NAMES)
      const cmcIdx = rng.nextInt(cmcIds.length)
      const row = createRow(db, schema.teacher, {
        lastName: female && !lastName.endsWith('а') ? `${lastName}а` : lastName,
        firstName: female ? rng.pick(FIRST_NAMES_F) : rng.pick(FIRST_NAMES_M),
        middleName: female ? rng.pick(PATRONYMICS_F) : rng.pick(PATRONYMICS_M),
        cmcId: cmcIds[cmcIdx]!,
        categoryId: categoryIdByCode.get(code)!,
        rate: code === 'staff' ? 1 : 0.5,
        maxHoursYear,
        maxPairsPerDay: code === 'hourly' ? 4 : 6,
        mainWorkplace: code === 'staff' ? null : rng.pick(WORKPLACES),
        hiredAt: VALID_FROM,
      })
      teachers.push({ id: row.id as number, cmcIdx })
      count('преподавателей')
    }
  }

  // Заведующие ЦМК — из штатных преподавателей соответствующей комиссии
  for (let i = 0; i < cmcIds.length; i++) {
    const head = teachers.find((t) => t.cmcIdx === i)
    if (head) {
      const row = db.select().from(schema.cmc).where(eq(schema.cmc.id, cmcIds[i]!)).get()!
      updateRow(db, schema.cmc, cmcIds[i]!, { headTeacherId: head.id }, row.rowVersion)
    }
  }

  // ── Квалификации: каждый преподаватель ведёт дисциплины своей ЦМК (§2.6, §3.5)
  const teachersByDiscipline = new Map<string, number[]>()
  for (const t of teachers) {
    const own = DISCIPLINES.filter((d) => d.cmc === t.cmcIdx)
    // Кроме «своих», по одной смежной — иначе редкие дисциплины остаются без преподавателей.
    const extra = rng.pick(DISCIPLINES)
    for (const d of new Set([...own, extra])) {
      createRow(db, schema.teacherQualification, { teacherId: t.id, disciplineId: disciplineIdByName.get(d.name)!, validFrom: VALID_FROM })
      const list = teachersByDiscipline.get(d.name) ?? []
      list.push(t.id)
      teachersByDiscipline.set(d.name, list)
      count('квалификаций')
    }
  }

  // ── Учебный год, семестры, календарь
  const academicYearId = createRow(db, schema.academicYear, { name: '2026/2027', startsOn: '2026-09-01', endsOn: '2027-06-30' }).id as number
  const autumnId = createRow(db, schema.semester, { academicYearId, no: 1, startsOn: '2026-09-01', endsOn: '2027-01-15', weeksCount: 18, status: 'active' }).id as number
  const springId = createRow(db, schema.semester, { academicYearId, no: 2, startsOn: '2027-02-09', endsOn: '2027-06-30', weeksCount: 18, status: 'planning' }).id as number
  count('семестров', 2)

  count('дней календаря', generateCalendarDays(db, autumnId) + generateCalendarDays(db, springId))
  for (const h of HOLIDAYS) {
    const day = db.select().from(schema.calendarDay).where(eq(schema.calendarDay.date, h.date)).get()
    if (!day) continue // праздник вне учебных периодов (например, в каникулы) — пропускаем
    setCalendarDayKind(db, { date: h.date, rowVersion: day.rowVersion, kind: 'holiday', note: h.note })
    count('праздников')
  }
  createRow(db, schema.calendarPeriod, { kind: 'vacation', course: null, specialityId: null, groupId: null, startsOn: '2027-01-16', endsOn: '2027-02-08', note: 'Зимние каникулы' })
  createRow(db, schema.calendarPeriod, { kind: 'practice', course: 3, specialityId: specialityIdByCode.get('СД')!, groupId: null, startsOn: '2026-12-01', endsOn: '2026-12-19', note: 'Производственная практика' })
  count('периодов календаря', 2)

  // ── Учебные планы: по одному на специальность, строки на осенние семестры (1, 3, 5, 7)
  interface PlanRow {
    id: number
    disciplineName: string
    kind: 'theory' | 'practice'
  }
  const planRowsBySpecCourse = new Map<string, PlanRow[]>()

  for (const spec of SPECIALITIES) {
    const specialityId = specialityIdByCode.get(spec.code)!
    const curriculumId = createRow(db, schema.curriculum, {
      specialityId,
      admissionYear: ADMISSION_BASE,
      name: `${spec.code} — набор ${ADMISSION_BASE}`,
      status: 'approved',
      approvedAt: VALID_FROM,
      approvedBy: 'Завуч',
    }).id as number
    count('учебных планов')

    const perCourse = PLAN_BY_SPECIALITY[spec.code]
    perCourse.forEach((sem, courseIdx) => {
      const course = courseIdx + 1
      const semesterNo = course * 2 - 1
      const names = [...sem.theory, ...sem.practice]
      const rows: PlanRow[] = []
      names.forEach((name, i) => {
        const spec2 = disciplineSpecByName.get(name)!
        const isPractice = i >= sem.theory.length
        const credits = CREDITS_PER_ROW[i]!
        const hoursTotal = credits * 30 // §3.1: кредиты × 30 = всего часов
        const hoursClassroom = 72 // 2 пары в неделю × 18 недель
        const created = createCurriculumRow(
          db,
          curriculumId,
          {
            disciplineId: disciplineIdByName.get(name)!,
            course,
            semesterNo,
            credits,
            hoursTotal,
            hoursClassroom,
            hoursTheory: isPractice ? 0 : hoursClassroom,
            hoursPractice: isPractice ? hoursClassroom : 0,
            hoursSeminar: 0,
            hoursLab: 0,
            hoursSrs: hoursTotal - hoursClassroom,
            controlSemester: spec2.block === 3 ? semesterNo : null,
          },
          VALID_FROM,
        )
        rows.push({ id: created.id as number, disciplineName: name, kind: isPractice ? 'practice' : 'theory' })
        count('строк учебного плана')
      })
      planRowsBySpecCourse.set(`${spec.code}-${course}`, rows)
    })
  }

  // ── Группы: 39 штук, 12 бюджетных и 27 контрактных (§9.2)
  interface GroupRec {
    id: number
    name: string
    code: SpecialityCode
    course: number
    studentsCount: number
  }
  const groupPlan: { code: SpecialityCode; course: number }[] = []
  for (const spec of SPECIALITIES) {
    // Групп на курс: младших больше, старших меньше — отсев к выпуску (в сумме ровно 39).
    const perCourse = GROUPS_PER_COURSE[spec.code]
    perCourse.forEach((n, courseIdx) => {
      for (let i = 0; i < n; i++) groupPlan.push({ code: spec.code, course: courseIdx + 1 })
    })
  }
  if (groupPlan.length !== 39) {
    throw new Error(`Ожидалось 39 групп по раскладке, получилось ${groupPlan.length} — поправьте раскладку в seed-demo.ts`)
  }

  const groups: GroupRec[] = []
  const numberByKey = new Map<string, number>()
  groupPlan.forEach((g, idx) => {
    const key = `${g.code}-${g.course}`
    const no = (numberByKey.get(key) ?? 0) + 1
    numberByKey.set(key, no)
    const name = `${g.course}${no} ${g.code}`
    const studentsCount = 18 + rng.nextInt(15) // 18..32 — реальный разброс медколледжа
    const row = createRow(db, schema.studyGroup, {
      name,
      specialityId: specialityIdByCode.get(g.code)!,
      admissionYear: ADMISSION_BASE - (g.course - 1),
      course: g.course,
      studentsCount,
      maxPairsPerDay: 6,
      maxHoursPerWeek: 45,
      funding: idx < 12 ? 'budget' : 'contract',
      validFrom: VALID_FROM,
    })
    groups.push({ id: row.id as number, name, code: g.code, course: g.course, studentsCount })
    count('групп')
  })

  // ── Схемы деления: «на 2 — языки» (основная) и «на 3 — клинические» (§2.5)
  const schemeByGroup = new Map<number, { two: { id: number; subgroupIds: number[] }; three: { id: number; subgroupIds: number[] } }>()
  for (const g of groups) {
    const two = createDivisionScheme(db, { groupId: g.id, semesterId: autumnId, name: 'на 2 — языки', partsCount: 2, isDefault: true })
    const three = createDivisionScheme(db, { groupId: g.id, semesterId: autumnId, name: 'на 3 — клинические', partsCount: 3, isDefault: false })
    schemeByGroup.set(g.id, {
      two: { id: two.id, subgroupIds: two.subgroups.map((s) => s.id) },
      three: { id: three.id, subgroupIds: three.subgroups.map((s) => s.id) },
    })
    count('схем деления', 2)
  }

  // ── Потоки: группы одной специальности и курса, где их больше одной (§3.5a)
  const streamsByKey = new Map<string, { id: number; groupIds: number[] }>()
  for (const [key, members] of groupBy(groups, (g) => `${g.code}-${g.course}`)) {
    if (members.length < 2) continue
    const created = createStream(db, {
      semesterId: autumnId,
      name: `Поток ${key.replace('-', ' курс ')}`,
      groupIds: members.map((m) => m.id),
      validFrom: VALID_FROM,
    })
    streamsByKey.set(key, { id: created.id, groupIds: members.map((m) => m.id) })
    count('потоков')
  }

  // ── Нагрузка
  let teacherCursor = 0
  const pickTeacher = (disciplineName: string): number => {
    const candidates = teachersByDiscipline.get(disciplineName)
    if (!candidates || candidates.length === 0) {
      throw new Error(`Некому вести «${disciplineName}» — ни одной квалификации; поправьте раскладку ЦМК в seed-demo.ts`)
    }
    // По кругу, а не случайно: нагрузка распределяется ровно, как её раскладывал бы завуч.
    return candidates[teacherCursor++ % candidates.length]!
  }

  const clinicalBuildingFor = (disciplineName: string, course: number): { buildingId: number; mode: 'full_day' | 'block' | 'free' } | null => {
    const spec = disciplineSpecByName.get(disciplineName)!
    if (!spec.requiresClinical) return null
    if (disciplineName === 'Физиологическое акушерство') return { buildingId: maternityId, mode: 'block' }
    if (disciplineName === 'Организация деятельности аптеки') return { buildingId: polyclinicId, mode: 'free' }
    // «Весь день на базе» — только у старших курсов: у младших это съело бы всю неделю.
    return course >= 3 ? { buildingId: hospitalId, mode: 'full_day' } : { buildingId: polyclinicId, mode: 'free' }
  }

  for (const g of groups) {
    const rows = planRowsBySpecCourse.get(`${g.code}-${g.course}`)
    if (!rows) continue
    const schemes = schemeByGroup.get(g.id)!

    for (const row of rows) {
      const spec = disciplineSpecByName.get(row.disciplineName)!
      const clinical = clinicalBuildingFor(row.disciplineName, g.course)

      if (row.kind === 'theory') {
        saveTeachingLoad(
          db,
          {
            semesterId: autumnId,
            curriculumRowId: row.id,
            teacherId: pickTeacher(row.disciplineName),
            groupId: g.id,
            streamId: null,
            divisionSchemeId: null,
            subgroupId: null,
            lessonKind: 'theory',
            hoursPlanned: 72,
            requiresParallel: false,
            roomTypeRequired: spec.roomType,
            clinicalModeOverride: null,
            note: null,
          },
          VALID_FROM,
          null,
        )
        count('строк нагрузки')
        continue
      }

      // Практика идёт по подгруппам: «на 3» для клинических, «на 2» для остальных,
      // все подгруппы занимаются параллельно (§3.6) — первые две связываются в пару.
      const scheme = spec.requiresClinical ? schemes.three : schemes.two
      const savedIds: number[] = []
      for (const subgroupId of scheme.subgroupIds) {
        const { row: saved } = saveTeachingLoad(
          db,
          {
            semesterId: autumnId,
            curriculumRowId: row.id,
            teacherId: pickTeacher(row.disciplineName),
            groupId: g.id,
            streamId: null,
            divisionSchemeId: scheme.id,
            subgroupId,
            lessonKind: 'practice',
            // По 36 ч на подгруппу: студент получает те же 36 ч, но у завуча в сумме по
            // группе стоят часы каждой подгруппы отдельно (так считает activeGroupTeachingHours).
            hoursPlanned: 36,
            requiresParallel: true,
            roomTypeRequired: spec.roomType,
            clinicalModeOverride: clinical?.mode ?? null,
            note: null,
          },
          VALID_FROM,
          null,
        )
        const savedId = saved.id as number
        savedIds.push(savedId)
        if (clinical) {
          updateRow(db, schema.teachingLoad, savedId, { buildingIdRequired: clinical.buildingId }, saved.rowVersion as number)
        }
        count('строк нагрузки')
      }
      if (savedIds.length >= 2) {
        linkPair(db, savedIds[0]!, savedIds[1]!)
        count('парных связок')
      }
    }
  }

  // ── Поточные лекции: одна на поток, часы преподавателю считаются один раз (§3.5a)
  for (const [key, stream] of streamsByKey) {
    const [code, courseText] = key.split('-') as [SpecialityCode, string]
    const rows = planRowsBySpecCourse.get(key)
    const lectureRow = rows?.find((r) => r.kind === 'theory')
    if (!lectureRow) continue
    saveTeachingLoad(
      db,
      {
        semesterId: autumnId,
        curriculumRowId: lectureRow.id,
        teacherId: pickTeacher(lectureRow.disciplineName),
        groupId: null,
        streamId: stream.id,
        divisionSchemeId: null,
        subgroupId: null,
        lessonKind: 'theory',
        hoursPlanned: 36,
        requiresParallel: false,
        roomTypeRequired: 'lecture',
        clinicalModeOverride: null,
        note: `Поточная лекция ${code}, ${courseText} курс`,
      },
      VALID_FROM,
      null,
    )
    count('строк нагрузки')
    count('поточных лекций')
  }

  // ── Недоступность преподавателей (§4.3): у совместителей есть закрытые дни
  for (const t of teachers.slice(90)) {
    if (rng.nextInt(10) >= 4) continue
    createRow(db, schema.teacherAbsence, {
      teacherId: t.id,
      kind: 'hard',
      scope: 'weekday',
      dayOfWeek: 1 + rng.nextInt(6),
      pairFrom: 1,
      pairTo: 6,
      weight: 0,
      reason: 'Основное место работы',
    })
    count('ограничений доступности')
  }

  // ── Пустой черновик шаблона: с него начинается генерация на приёмке
  const template = createTemplate(db, { semesterId: autumnId, effectiveFrom: '2026-09-01', note: 'Черновик под генерацию' })
  count('шаблонов расписания')

  return { counters, templateId: template.id as number, semesterId: autumnId }
}

/** Связывает две строки нагрузки как параллельные подгруппы (§3.6, `paired_load_id`). */
function linkPair(db: Db, aId: number, bId: number): void {
  const a = db.select().from(schema.teachingLoad).where(eq(schema.teachingLoad.id, aId)).get()!
  updateRow(db, schema.teachingLoad, aId, { pairedLoadId: bId }, a.rowVersion)
  const b = db.select().from(schema.teachingLoad).where(eq(schema.teachingLoad.id, bId)).get()!
  updateRow(db, schema.teachingLoad, bId, { pairedLoadId: aId }, b.rowVersion)
}

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>()
  for (const item of items) {
    const k = key(item)
    const list = out.get(k) ?? []
    list.push(item)
    out.set(k, list)
  }
  return out
}

// ─────────────────────────────────────────────────────────────────────────────────────────

function main() {
  const args = process.argv.slice(2)
  const force = args.includes('--force')
  const target = args.find((a) => !a.startsWith('--')) ?? defaultDbPath()

  console.log(`[seed] целевая БД: ${target}`)

  if (existsSync(target)) {
    const probe = createDb(target)
    runMigrations(probe.db, './drizzle')
    const groups = probe.db.select({ id: schema.studyGroup.id }).from(schema.studyGroup).all()
    probe.sqlite.close()

    if (groups.length > 0 && !force) {
      console.error(
        `\n[seed] В этой БД уже есть данные (${groups.length} групп). Демо-колледж не записан.\n` +
          `       Чтобы перезаписать: npm run seed:demo -- --force (прежний файл будет скопирован рядом).\n` +
          `       Чтобы наполнить другую БД: npm run seed:demo -- ./scripts/.demo.db`,
      )
      process.exit(1)
    }
    if (groups.length > 0) {
      const backup = `${target}.before-seed-${new Date().toISOString().replace(/[:.]/g, '-')}`
      copyFileSync(target, backup)
      console.log(`[seed] прежняя БД сохранена: ${backup}`)
      for (const suffix of ['', '-wal', '-shm']) rmSync(`${target}${suffix}`, { force: true })
    }
  }

  const { db, sqlite } = createDb(target)
  runMigrations(db, './drizzle')

  const started = Date.now()
  const { counters, templateId, semesterId } = db.transaction((tx) => seedDemo(tx as unknown as Db))
  sqlite.close()

  console.log(`\n[seed] Демо-колледж готов за ${Date.now() - started} мс:`)
  for (const [key, value] of Object.entries(counters)) console.log(`  ${key}: ${value}`)
  console.log(`\n  осенний семестр: #${semesterId}, черновик шаблона: #${templateId}`)
  console.log('  Дальше: npm run dev → «Генерация расписания» → выбрать этот шаблон → «Сгенерировать».')
}

main()
