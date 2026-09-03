import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Discipline, ScheduleTemplate, StudyGroup, Teacher } from '../../../../shared/ipc/contract'
import { describeUnplaced } from '../../../../shared/schedule/messages'
import type { SolverInput, SolverOutput, SolverProgress, Unit } from '../../../../solver/model'
import { api } from '../../api/client'
import { notifyError, notifySuccess } from '../../ui/toast'
import { useSemesterOptions } from '../load/useSemesterOptions'

/** Экран генерации расписания (§5.7-5.8 PLAN.md): запуск солвера, прогресс, отмена, применение. */
export function GenerationPage() {
  const { semesters, label: semesterLabel } = useSemesterOptions()
  const [semesterId, setSemesterId] = useState<number | ''>('')
  const selectedSemesterId = semesterId !== '' ? semesterId : (semesters[0]?.id ?? '')

  const [templates, setTemplates] = useState<ScheduleTemplate[]>([])
  const [templateId, setTemplateId] = useState<number | ''>('')

  const [teachers, setTeachers] = useState<Teacher[]>([])
  const [disciplines, setDisciplines] = useState<Discipline[]>([])
  const [groups, setGroups] = useState<StudyGroup[]>([])

  const [jobId, setJobId] = useState<string | null>(null)
  const [progress, setProgress] = useState<SolverProgress | null>(null)
  const [draft, setDraft] = useState<{ input: SolverInput; output: SolverOutput } | null>(null)
  const [applying, setApplying] = useState(false)

  const navigate = useNavigate()

  useEffect(() => {
    void api.invoke('teachers:list', {}).then((res) => res.ok && setTeachers(res.value))
    void api.invoke('disciplines:list', {}).then((res) => res.ok && setDisciplines(res.value))
    void api.invoke('groups:list', {}).then((res) => res.ok && setGroups(res.value))
  }, [])

  useEffect(() => {
    if (selectedSemesterId === '') return
    void api.invoke('scheduleTemplates:list', { semesterId: selectedSemesterId }).then((res) => {
      if (!res.ok) return
      setTemplates(res.value)
      setTemplateId((current) => (current !== '' && res.value.some((t) => t.id === current) ? current : (res.value.at(-1)?.id ?? '')))
    })
  }, [selectedSemesterId])

  useEffect(() => {
    if (!jobId) return
    const offProgress = api.on('generation:progress', (payload) => {
      if (payload.jobId === jobId) setProgress(payload)
    })
    const offDone = api.on('generation:done', (payload) => {
      if (payload.jobId !== jobId) return
      setDraft({ input: payload.input, output: payload.output })
      setProgress(null)
    })
    const offFailed = api.on('generation:failed', (payload) => {
      if (payload.jobId !== jobId) return
      notifyError(payload.message)
      setJobId(null)
      setProgress(null)
    })
    return () => {
      offProgress()
      offDone()
      offFailed()
    }
  }, [jobId])

  const teacherById = useMemo(() => new Map(teachers.map((t) => [t.id, t])), [teachers])
  const disciplineById = useMemo(() => new Map(disciplines.map((d) => [d.id, d])), [disciplines])
  const groupById = useMemo(() => new Map(groups.map((g) => [g.id, g])), [groups])

  function teacherName(idx: number): string {
    const id = draft?.input.teachers[idx]?.id
    const t = id != null ? teacherById.get(id) : undefined
    return t ? `${t.lastName} ${t.firstName}` : `#${idx}`
  }
  function disciplineName(idx: number): string {
    const d = disciplineById.get(idx)
    return d ? d.name : `дисциплина #${idx}`
  }
  function targetLabel(unit: Unit): string {
    return unit.attendees
      .map((a) => {
        const id = draft?.input.groups[a.groupIdx]?.id
        const g = id != null ? groupById.get(id) : undefined
        return g?.name ?? `#${a.groupIdx}`
      })
      .join(' + ')
  }

  async function handleStart() {
    if (templateId === '') return
    setDraft(null)
    setProgress(null)
    const res = await api.invoke('generation:start', { templateId })
    if (!res.ok) {
      notifyError(res.error.message)
      return
    }
    setJobId(res.value.jobId)
  }

  async function handleCancel() {
    if (!jobId) return
    await api.invoke('generation:cancel', { jobId })
    setJobId(null)
    setProgress(null)
  }

  async function handleDiscard() {
    // Черновик живёт в памяти main до применения — отпускаем его там же, а не только в UI.
    if (jobId) await api.invoke('generation:cancel', { jobId })
    setJobId(null)
    setDraft(null)
  }

  async function handleApply() {
    if (!jobId) return
    setApplying(true)
    const res = await api.invoke('generation:apply', { jobId })
    setApplying(false)
    if (!res.ok) {
      notifyError(res.error.message)
      return
    }
    notifySuccess(`Черновик применён: создано занятий — ${res.value.created}`)
    setJobId(null)
    setDraft(null)
    navigate('/schedule-template')
  }

  const generating = jobId != null && draft == null
  const unitsById = useMemo(() => new Map((draft?.input.units ?? []).map((u) => [u.id, u])), [draft])

  return (
    <div className="page">
      <h2>Генерация расписания</h2>

      <div className="toolbar">
        <label>
          Семестр
          <select value={selectedSemesterId} onChange={(e) => setSemesterId(Number(e.target.value))} disabled={generating}>
            {semesters.map((s) => (
              <option key={s.id} value={s.id}>
                {semesterLabel(s.id)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Версия шаблона
          <select value={templateId} onChange={(e) => setTemplateId(Number(e.target.value))} disabled={generating}>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                v{t.versionNo} · {t.status}
              </option>
            ))}
          </select>
        </label>
        {!generating && draft == null && (
          <button onClick={() => void handleStart()} disabled={templateId === ''}>
            Сгенерировать
          </button>
        )}
        {generating && (
          <button onClick={() => void handleCancel()} className="danger">
            Отмена
          </button>
        )}
      </div>

      {generating && (
        <div className="generation-progress">
          <progress value={progress?.percent ?? 0} max={100} />
          <span>
            {progress ? `${progress.percent}% · размещено ${progress.placed} из ${progress.total}` : 'Запуск…'}
          </span>
        </div>
      )}

      {draft && (
        <div className="generation-result">
          <p>
            Размещено {draft.output.assignments.length} из {draft.input.units.length}, штраф {draft.output.penalty},
            за {draft.output.elapsedMs} мс ({draft.output.iterations} итераций)
          </p>
          <div className="toolbar">
            <button onClick={() => void handleApply()} disabled={applying}>
              {applying ? 'Применяю…' : 'Применить'}
            </button>
            <button onClick={() => void handleDiscard()}>Отклонить черновик</button>
          </div>

          {draft.output.unplaced.length > 0 && (
            <div className="unplaced-panel">
              <h3>Не удалось разместить: {draft.output.unplaced.length}</h3>
              <ul>
                {draft.output.unplaced.map((item) => {
                  const unit = unitsById.get(item.unitId)
                  if (!unit) return null
                  return (
                    <li key={item.unitId}>
                      {describeUnplaced(unit, item, { teacherName, disciplineName, targetLabel })}
                      {' · '}
                      <a
                        href="#"
                        onClick={(e) => {
                          e.preventDefault()
                          navigate('/schedule-template')
                        }}
                      >
                        Поставить вручную
                      </a>
                    </li>
                  )
                })}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
