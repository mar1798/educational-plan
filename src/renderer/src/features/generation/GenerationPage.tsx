import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Discipline, ScheduleTemplate, StudyGroup, Teacher } from '../../../../shared/ipc/contract'
import { describeUnplaced } from '../../../../shared/schedule/messages'
import { WEIGHT_BREAKDOWN_LABEL, weightKeyForCode } from '../../../../shared/schedule/weights'
import type { SolverInput, SolverOutput, SolverProgress, Unit } from '../../../../solver/model'
import { api } from '../../api/client'
import { notifyError, notifySuccess } from '../../ui/toast'
import { useSemesterOptions } from '../load/useSemesterOptions'

const PHASE_LABEL: Record<SolverProgress['phase'], string> = {
  greedy: 'Жадная расстановка',
  search: 'Локальный поиск (улучшение расписания)',
}

interface BreakdownRow {
  code: string
  label: string
  raw: number
  weighted: number
  percent: number
}

function breakdownRows(output: SolverOutput, input: SolverInput): BreakdownRow[] {
  const weighted = Object.entries(output.breakdown)
    .filter(([code]) => code !== 'unplaced')
    .map(([code, raw]) => {
      const key = weightKeyForCode(code)
      const weight = key ? input.weights[key] : 0
      return { code, label: key ? WEIGHT_BREAKDOWN_LABEL[key] : code, raw, weighted: raw * weight }
    })
  const total = weighted.reduce((sum, r) => sum + r.weighted, 0)
  return weighted
    .map((r) => ({ ...r, percent: total > 0 ? Math.round((r.weighted / total) * 100) : 0 }))
    .sort((a, b) => b.weighted - a.weighted)
}

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
  const [stopping, setStopping] = useState(false)

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
      setStopping(false)
    })
    const offFailed = api.on('generation:failed', (payload) => {
      if (payload.jobId !== jobId) return
      notifyError(payload.message)
      setJobId(null)
      setProgress(null)
      setStopping(false)
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
    setStopping(false)
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

  // «Остановить и взять результат» (§5.7): локальный поиск улучшает уже готовое расписание,
  // поэтому дожидаться полного бюджета в 60 с ради последних процентов штрафа нужно не всегда.
  // Солвер останавливается кооперативно и присылает лучшее найденное решение — черновик
  // приходит обычным 'generation:done', в отличие от «Отмены», которая результат выбрасывает.
  async function handleStop() {
    if (!jobId) return
    setStopping(true)
    const res = await api.invoke('generation:cancel', { jobId, keepResult: true })
    if (!res.ok) {
      setStopping(false)
      notifyError(res.error.message)
    }
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
    <div>
      <div className="page-header">
        <h1>Генерация расписания</h1>
        <div className="toolbar-actions">
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
            <button type="button" className="btn btn-primary" onClick={() => void handleStart()} disabled={templateId === ''}>
              Сгенерировать
            </button>
          )}
        </div>
      </div>

      {!generating && draft == null && (
        <p className="history-empty">
          Солвер расставит нагрузку выбранной версии шаблона по сетке 36 слотов. Расчёт занимает до минуты, результат
          сначала показывается черновиком — в расписание он попадёт только после кнопки «Применить».
        </p>
      )}

      {generating && (
        <div className="card generation-progress">
          <span className="generation-progress-phase">
            {progress
              ? `${PHASE_LABEL[progress.phase]} · ${progress.percent}% · размещено ${progress.placed} из ${progress.total}`
              : 'Запуск…'}
          </span>
          <progress value={progress?.percent ?? 0} max={100} />
          <div className="btn-group">
            <button type="button" className="btn" onClick={() => void handleStop()} disabled={stopping}>
              {stopping ? 'Останавливаю…' : 'Остановить и взять результат'}
            </button>
            <button type="button" className="btn btn-danger" onClick={() => void handleCancel()} disabled={stopping}>
              Отмена
            </button>
          </div>
          <p className="generation-hint">
            Полный расчёт длится около минуты. «Остановить и взять результат» прервёт улучшение и покажет лучшее из
            найденного, «Отмена» — прекратит расчёт и ничего не сохранит.
          </p>
        </div>
      )}

      {draft && (
        <div className="card generation-result">
          <div className="generation-summary">
            <div>
              <span className="generation-metric-label">Размещено</span>
              <span className="generation-metric-value">
                {draft.output.assignments.length} из {draft.input.units.length}
              </span>
            </div>
            <div>
              <span className="generation-metric-label">Штраф</span>
              <span className="generation-metric-value">{draft.output.penalty}</span>
            </div>
            <div>
              <span className="generation-metric-label">Время расчёта</span>
              <span className="generation-metric-value">{Math.round(draft.output.elapsedMs / 1000)} с</span>
            </div>
            <div>
              <span className="generation-metric-label">Итераций</span>
              <span className="generation-metric-value">{draft.output.iterations.toLocaleString('ru-RU')}</span>
            </div>
          </div>

          {draft.output.penalty > 0 && (
            <details className="penalty-breakdown">
              <summary>Из чего складывается штраф</summary>
              <ul>
                {breakdownRows(draft.output, draft.input)
                  .filter((r) => r.raw > 0)
                  .map((r) => (
                    <li key={r.code}>
                      {r.label}: {r.raw} (вклад {r.percent} %)
                    </li>
                  ))}
              </ul>
            </details>
          )}

          <div className="btn-group" style={{ marginTop: 16 }}>
            <button type="button" className="btn btn-primary" onClick={() => void handleApply()} disabled={applying}>
              {applying ? 'Применяю…' : 'Применить и открыть сетку'}
            </button>
            <button type="button" className="btn" onClick={() => void handleDiscard()} disabled={applying}>
              Отклонить черновик
            </button>
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
