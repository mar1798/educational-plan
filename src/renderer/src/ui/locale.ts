export const ruCommon = {
  save: 'Сохранить',
  cancel: 'Отмена',
  create: 'Добавить',
  edit: 'Изменить',
  archive: 'Архивировать',
  restore: 'Восстановить',
  close: 'Закрыть',
  delete: 'Удалить',
  yesDelete: 'Да, удалить',
  yesClose: 'Да, закрыть',
  confirm: 'Подтвердить',
  search: 'Поиск…',
  emptyTable: 'Записей нет',
  loading: 'Загрузка…',
  showArchived: 'Показывать архивные',
  confirmDeleteTitle: 'Удалить запись?',
  confirmDeleteBody: 'Действие необратимо.',
  confirmCloseTitle: 'Закрыть запись?',
  savedOk: 'Сохранено',
  deletedOk: 'Удалено',
  archivedOk: 'Отправлено в архив',
  restoredOk: 'Восстановлено из архива',
  closedOk: 'Закрыто',
} as const

// Пн–Сб (§2, §4.4): учебная неделя без воскресенья, 1..6.
export const WEEKDAY_LABEL: Record<number, string> = {
  1: 'Понедельник',
  2: 'Вторник',
  3: 'Среда',
  4: 'Четверг',
  5: 'Пятница',
  6: 'Суббота',
}

export const ROOM_TYPE_LABEL = {
  lecture: 'Лекционная',
  practice: 'Практическая',
  seminar: 'Семинарская',
  lab: 'Лаборатория',
  phantom: 'Фантомная',
  computer: 'Компьютерная',
  gym: 'Спортзал',
} as const

export function paginationLabel(pageIndex: number, pageSize: number, total: number): string {
  if (total === 0) return 'Показаны 0 из 0'
  const from = pageIndex * pageSize + 1
  const to = Math.min(total, (pageIndex + 1) * pageSize)
  return `Показаны ${from}–${to} из ${total}`
}
