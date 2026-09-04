import { useCallback, useEffect, useState } from 'react'
import type { StreamWithMembers, StudyGroup } from '../../../../shared/ipc/contract'
import { api } from '../../api/client'
import { ConfirmDialog } from '../../ui/ConfirmDialog'
import { notifyError, notifySuccess } from '../../ui/toast'
import { CreateStreamDialog } from './CreateStreamDialog'
import { useSemesterOptions } from './useSemesterOptions'
import { FilterSelect } from '../../ui/FilterSelect'
import { useInitialSelection } from '../../ui/useInitialSelection'

/**
 * Потоки (§3.5a): лекция читается сразу нескольким группам одной специальности и курса.
 * Расформирование распадает поточные строки нагрузки обратно на группы-участницы.
 */
export function StreamsPage() {
  const { semesters, label: semesterLabel } = useSemesterOptions()
  const [semesterId, setSemesterId] = useState<number | ''>('')
  const [streams, setStreams] = useState<StreamWithMembers[] | null>(null)
  const [groups, setGroups] = useState<StudyGroup[]>([])
  const [creating, setCreating] = useState(false)
  const [pendingDisband, setPendingDisband] = useState<StreamWithMembers | null>(null)

  // Пока завуч явно не выбрал семестр, подставляем первый из списка — но ровно один раз,
  // на его приезд: пока это считалось на каждый рендер, пустой пункт фильтра выбрать было
  // нельзя, значение тут же возвращалось к первому семестру.
  useInitialSelection(semesters, semesterId !== '', (list) => setSemesterId(list[0]!.id))
  const selectedSemesterId = semesterId

  useEffect(() => {
    void api.invoke('groups:list', {}).then((res) => res.ok && setGroups(res.value))
  }, [])

  const refresh = useCallback(() => {
    if (selectedSemesterId === '') return Promise.resolve()
    return api.invoke('streams:listForSemester', { semesterId: selectedSemesterId }).then((res) => {
      if (res.ok) setStreams(res.value)
      else notifyError(res.error.message)
    })
  }, [selectedSemesterId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const groupName = (id: number) => groups.find((g) => g.id === id)?.name ?? `#${id}`

  async function confirmDisband() {
    if (!pendingDisband) return
    const res = await api.invoke('streams:disband', { id: pendingDisband.id })
    setPendingDisband(null)
    if (res.ok) {
      notifySuccess(`Поток расформирован, нагрузка распределена по ${res.value.createdLoadIds.length} строкам групп`)
      await refresh()
    } else {
      notifyError(res.error.message)
    }
  }

  return (
    <div>
      <div className="page-header">
        <h1>Потоки</h1>
        <div className="toolbar-actions">
          <FilterSelect
            label="Семестр"
            hint="Семестр, в котором собраны потоки"
            value={selectedSemesterId}
            onChange={(v) => setSemesterId(v === '' ? '' : Number(v))}
          >
            <option value="">Выберите семестр</option>
            {semesters.map((s) => (
              <option key={s.id} value={s.id}>
                {semesterLabel(s.id)}
              </option>
            ))}
          </FilterSelect>
          <button type="button" className="btn btn-primary" disabled={selectedSemesterId === ''} onClick={() => setCreating(true)}>
            + Создать поток
          </button>
        </div>
      </div>

      {selectedSemesterId === '' && <p className="history-empty">Выберите семестр</p>}
      {selectedSemesterId !== '' && streams?.length === 0 && <p className="history-empty">Потоков в этом семестре пока нет</p>}

      {streams?.map((s) => (
        <div className="card" key={s.id}>
          <div className="scheme-card-header">
            <strong>{s.name}</strong>
            <button type="button" className="btn-link" onClick={() => setPendingDisband(s)}>
              Расформировать
            </button>
          </div>
          <p>Группы: {s.members.map((m) => groupName(m.groupId)).join(', ')}</p>
        </div>
      ))}

      {creating && selectedSemesterId !== '' && (
        <CreateStreamDialog
          semesterId={selectedSemesterId}
          groups={groups}
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false)
            void refresh()
          }}
        />
      )}

      {pendingDisband && (
        <ConfirmDialog
          open
          title={`Расформировать поток «${pendingDisband.name}»?`}
          description="Нагрузка потока распадётся на отдельные строки для каждой группы-участницы с теми же часами."
          confirmLabel="Расформировать"
          danger
          onConfirm={() => void confirmDisband()}
          onCancel={() => setPendingDisband(null)}
        />
      )}
    </div>
  )
}
