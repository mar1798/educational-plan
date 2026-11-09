import { useCallback, useEffect, useState } from 'react'
import type { StreamCandidate, StreamWithMembers, StudyGroup } from '../../../../shared/ipc/contract'
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
 * «Возможные потоки» (решение 54): main находит одинаковые лекции групп, завуч подтверждает.
 */
export function StreamsPage() {
  const { semesters, label: semesterLabel } = useSemesterOptions()
  const [semesterId, setSemesterId] = useState<number | ''>('')
  const [streams, setStreams] = useState<StreamWithMembers[] | null>(null)
  const [groups, setGroups] = useState<StudyGroup[]>([])
  const [creating, setCreating] = useState(false)
  const [pendingDisband, setPendingDisband] = useState<StreamWithMembers | null>(null)
  const [candidates, setCandidates] = useState<StreamCandidate[] | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [merging, setMerging] = useState(false)

  // Пока завуч явно не выбрал семестр, подставляем первый из списка — но ровно один раз,
  // на его приезд: пока это считалось на каждый рендер, пустой пункт фильтра выбрать было
  // нельзя, значение тут же возвращалось к первому семестру.
  useInitialSelection(semesters, semesterId !== '', (list) => setSemesterId(list[0]!.id))
  const selectedSemesterId = semesterId

  useEffect(() => {
    void api.invoke('groups:list', {}).then((res) => (res.ok ? setGroups(res.value) : notifyError(res.error.message)))
  }, [])

  const refresh = useCallback(() => {
    if (selectedSemesterId === '') return Promise.resolve()
    return Promise.all([
      api.invoke('streams:listForSemester', { semesterId: selectedSemesterId }).then((res) => {
        if (res.ok) setStreams(res.value)
        else notifyError(res.error.message)
      }),
      api.invoke('streams:detect', { semesterId: selectedSemesterId }).then((res) => {
        if (!res.ok) return notifyError(res.error.message)
        setCandidates(res.value)
        // По умолчанию отмечено всё, что можно объединить: обычный случай — согласиться со всем списком.
        setPicked(new Set(res.value.filter((c) => c.blocked == null).map((c) => c.key)))
      }),
    ]).then(() => undefined)
  }, [selectedSemesterId])

  async function mergePicked() {
    if (selectedSemesterId === '' || picked.size === 0) return
    setMerging(true)
    const res = await api.invoke('streams:mergeDetected', { semesterId: selectedSemesterId, keys: [...picked] })
    setMerging(false)
    if (!res.ok) return notifyError(res.error.message)
    const { merged, streamsCreated, removedEntries, skipped } = res.value
    let text = `Объединено лекций: ${merged}, новых потоков: ${streamsCreated}`
    if (removedEntries > 0) text += `. Из черновых версий шаблона снято записей: ${removedEntries} — запустите генерацию заново`
    notifySuccess(text)
    for (const m of skipped) notifyError(m)
    await refresh()
  }

  function togglePick(key: string) {
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

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
          <button
            type="button"
            className="btn btn-primary"
            disabled={selectedSemesterId === ''}
            title={selectedSemesterId === '' ? 'Сначала выберите семестр' : undefined}
            onClick={() => setCreating(true)}
          >
            + Создать поток
          </button>
        </div>
      </div>

      {selectedSemesterId === '' && <p className="history-empty">Выберите семестр</p>}
      {selectedSemesterId !== '' && streams?.length === 0 && <p className="history-empty">Потоков в этом семестре пока нет</p>}

      {candidates != null && candidates.length > 0 && (
        <div className="card">
          <div className="scheme-card-header">
            <strong>Возможные потоки: {candidates.length}</strong>
            <button type="button" className="btn btn-primary" disabled={picked.size === 0 || merging} onClick={() => void mergePicked()}>
              {merging ? 'Объединяю…' : `Объединить выбранные (${picked.size})`}
            </button>
          </div>
          <p className="history-empty">
            Одну и ту же лекцию один преподаватель читает нескольким группам отдельными строками нагрузки. Пока это не поток,
            генерация ставит её каждой группе в свою пару, а в сводном расписании поточная пара не видна.
          </p>
          <ul className="stream-candidates">
            {candidates.map((c) => (
              <li key={c.key}>
                <label>
                  <input type="checkbox" checked={picked.has(c.key)} disabled={c.blocked != null} onChange={() => togglePick(c.key)} />{' '}
                  <strong>{c.disciplineName}</strong> — {c.groupNames.join(', ')} · {c.teacherName} · {c.hoursPlanned} ч
                  {c.draftEntries > 0 && <small> · снимется из черновиков шаблона: {c.draftEntries}</small>}
                </label>
                {c.blocked && <div className="form-error">{c.blocked}</div>}
              </li>
            ))}
          </ul>
        </div>
      )}

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
