export interface NavItem {
  label: string
  path: string
}

export interface NavSection {
  title: string
  items: NavItem[]
}

export const navSections: NavSection[] = [
  {
    title: 'Справочники',
    items: [
      { label: 'Специальности', path: '/specialities' },
      { label: 'ЦМК', path: '/cmc' },
      { label: 'Корпуса', path: '/buildings' },
      { label: 'Кабинеты', path: '/rooms' },
      { label: 'Дисциплины', path: '/disciplines' },
      { label: 'Преподаватели', path: '/teachers' },
      { label: 'Группы', path: '/groups' },
    ],
  },
  {
    title: 'Календарь',
    items: [
      { label: 'Учебные годы', path: '/academic-years' },
      { label: 'Семестры', path: '/semesters' },
      { label: 'Периоды учебного процесса', path: '/calendar-periods' },
      { label: 'Календарь года', path: '/calendar-year' },
    ],
  },
  {
    title: 'Система',
    items: [
      { label: 'Бэкапы и восстановление', path: '/system' },
      { label: 'Операции', path: '/operations' },
      { label: 'Сетка звонков', path: '/pair-grid' },
    ],
  },
]
