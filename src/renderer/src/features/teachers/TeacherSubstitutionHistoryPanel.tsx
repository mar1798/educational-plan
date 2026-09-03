import { useCallback, useEffect, useState } from 'react'
import type { SubstitutionHistoryRow } from '../../../../shared/ipc/contract'
import { api } from '../../api/client'

interface TeacherSubstitutionHistoryPanelProps {
  teacherId: number
}

const KIND_LABEL: Record<SubstitutionHistoryRow['kind'], string> = {
  teacher_swap: 'Замена преподавателя',
  room_swap: 'Замена кабинета',
  cancel: 'Отмена занятия',
  move: 'Перенос занятия',
}

function summarize(item: SubstitutionHistoryRow): string {
  if (item.kind === 'cancel') return 'Занятие отменено'
  if (item.kind === 'move') return 'Занятие перенесено'
  if (item.otherTeacherName == null) return KIND_LABEL[item.kind]
  return item.role === 'original' ? `Заменён на ${item.otherTeacherName}` : `Замещал ${item.otherTeacherName}`
}

/** История замен на карточке преподавателя (§этап 7, §1.1 п.29) — и как отсутствующий, и как замена. */
export function TeacherSubstitutionHistoryPanel({ teacherId }: TeacherSubstitutionHistoryPanelProps) {
  const [items, setItems] = useState<SubstitutionHistoryRow[] | null>(null)

  const load = useCallback(
    () =>
      api.invoke('substitutions:teacherHistory', { teacherId }).then((res) => {
        if (res.ok) setItems(res.value)
      }),
    [teacherId],
  )

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="subpanel">
      <h3>История замен</h3>
      {items === null && <p className="history-empty">Загрузка…</p>}
      {items?.length === 0 && <p className="history-empty">Замен не было</p>}
      {items?.map((item) => (
        <div className="subpanel-row" key={item.id}>
          <span>
            {item.date}, пара {item.pairNo} — {item.disciplineName}: {summarize(item)}
            {item.reason ? ` (${item.reason})` : ''}
          </span>
        </div>
      ))}
    </div>
  )
}
