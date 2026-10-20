import type { BlockHeaderRule, TargetEntity } from './engine'

/** Настройка колонки в мастере импорта: индекс колонки = позиция в массиве. */
export interface ColumnConfig {
  field: string
  inherit: boolean
  constants?: Record<string, string>
}

/**
 * Формат `import_profile.mappingJson` (§3.8d) — только *как читать*: диапазон, сопоставление,
 * правила. Ни пути к файлу, ни имени листа: один профиль годится для листов «Бюджет» и «Контракт».
 */
export interface SavedMapping {
  dataStartRow: number
  dataEndRow: number | null
  columns: ColumnConfig[]
  servicePattern: string
  headerRules?: BlockHeaderRule[]
  /** Колонки «Проверки расхождений» (§3.8c): ключ объекта и проверяемое значение. */
  discrepancy?: { keyColumn: number; valueColumn: number }
}

export interface ImportPreset {
  key: string
  name: string
  description: string
  targetEntity: TargetEntity
  mapping: SavedMapping
}

const empty: ColumnConfig = { field: '', inherit: false }
const hours = (lessonKind: string, halfYear: string): ColumnConfig => ({ field: 'hoursPlanned', inherit: false, constants: { lessonKind, halfYear } })

/**
 * Готовые сопоставления, которые поставляются с программой. Это не парсер под файл
 * (решения п. 47): тот же профиль, что завуч собрал бы в мастере сам, — его можно
 * выбрать, поправить и сохранить своим. Раскладка проверяется на настоящем файле
 * колледжа в tests/db/import-annual-load.test.ts.
 */
export const IMPORT_PRESETS: ImportPreset[] = [
  {
    key: 'annual-load',
    name: 'Годовая нагрузка (листы «Бюджет», «Контракт»)',
    description:
      'Цикл и преподаватель — строками над блоком групп; часы «Нагрузка» лекций и практики за I и II полугодие в колонках G, H, M, N. ' +
      'Берутся часы, которые получает группа, а не «Кол-во часов» преподавателя с учётом подгрупп.',
    targetEntity: 'teaching_load',
    mapping: {
      dataStartRow: 8,
      dataEndRow: null,
      servicePattern: 'итого|всего',
      headerRules: [
        { columnIndex: 1, pattern: '^\\d+$', field: 'disciplineName', sourceColumnIndex: 3 },
        { columnIndex: 1, pattern: '', field: 'teacherName', sourceColumnIndex: 1 },
      ],
      // Численность одной группы в файле бывает разной («СД-12»: 24 и 23) — по ней заводятся
      // новые группы, и выбрать значение должен завуч (решения п. 43).
      discrepancy: { keyColumn: 3, valueColumn: 4 },
      columns: [
        empty, // A — поле страницы
        empty, // B — № цикла / ФИО (читается правилами строк-заголовков)
        empty, // C — № п/п
        { field: 'groupName', inherit: false }, // D
        { field: 'studentsCount', inherit: false }, // E — Кол-во ст.
        empty, // F — Подг
        hours('Лек.', 'I'), // G
        hours('Практ.', 'I'), // H
        empty, // I
        empty, // J
        empty, // K
        empty, // L — Тест: прочие часы, в сетку не ставятся (решения п. 36)
        hours('Лек.', 'II'), // M
        hours('Практ.', 'II'), // N
      ],
    },
  },
]
