import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Discipline, LectureCoverageItem, ScheduleTemplate, SemesterPhasesView, SemesterPhaseView, StudyGroup, Teacher } from '../../../../shared/ipc/contract'
import { describeUnplaced } from '../../../../shared/schedule/messages'
import { WEIGHT_BREAKDOWN_LABEL, weightKeyForCode } from '../../../../shared/schedule/weights'
import type { SolverInput, SolverOutput, SolverProgress, Unit } from '../../../../solver/model'
import { api } from '../../api/client'
import { notifyError, notifySuccess } from '../../ui/toast'
import { useSemesterOptions } from '../load/useSemesterOptions'
import { FilterSelect } from '../../ui/FilterSelect'
import { useInitialSelection } from '../../ui/useInitialSelection'

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
  useInitialSelection(semesters, semesterId !== '', (list) => setSemesterId(list[0]!.id))
  const selectedSemesterId = semesterId

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

  // Фазы семестра (§этап Д): каждая фаза считается отдельно, результаты применяются разом.
  const [phaseReport, setPhaseReport] = useState<SemesterPhasesView | null>(null)
  const [runs, setRuns] = useState<{ phase: SemesterPhaseView; jobId: string; draft: { input: SolverInput; output: SolverOutput } }[]>([])
  const [viewRun, setViewRun] = useState(0)
  const [currentPhase, setCurrentPhase] = useState<SemesterPhaseView | null>(null)
  // Пока идёт цепочка фаз, 'generation:done' обрабатывает сама цепочка, а не одиночный черновик.
  const multiRef = useRef(false)
  const abortChainRef = useRef(false)
  const cancelWaitRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    if (templateId === '') return
    void api.invoke('generation:phases', { templateId }).then((res) => (res.ok ? setPhaseReport(res.value) : notifyError(res.error.message)))
  }, [templateId])

  // Дисциплины, где к началу практики пройдено меньше порога лекций: предупреждение, генерацию не блокирует.
  const [coverageWarnings, setCoverageWarnings] = useState<LectureCoverageItem[]>([])
  // Необъединённые поточные лекции (решение 54): генерация поставит их группам в разные пары.
  const [streamCandidates, setStreamCandidates] = useState(0)
  useEffect(() => {
    if (selectedSemesterId === '') return
    void api.invoke('load:lectureCoverage', { semesterId: selectedSemesterId }).then((res) => setCoverageWarnings(res.ok ? res.value.filter((i) => !i.ok) : []))
    void api.invoke('streams:detect', { semesterId: selectedSemesterId }).then((res) => setStreamCandidates(res.ok ? res.value.length : 0))
  }, [selectedSemesterId])

  useEffect(() => {
    void api.invoke('teachers:list', {}).then((res) => (res.ok ? setTeachers(res.value) : notifyError(res.error.message)))
    void api.invoke('disciplines:list', {}).then((res) => (res.ok ? setDisciplines(res.value) : notifyError(res.error.message)))
    void api.invoke('groups:list', {}).then((res) => (res.ok ? setGroups(res.value) : notifyError(res.error.message)))
  }, [])

  useEffect(() => {
    if (selectedSemesterId === '') return
    void api.invoke('scheduleTemplates:list', { semesterId: selectedSemesterId }).then((res) => {
      if (!res.ok) return notifyError(res.error.message)
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
      if (payload.jobId !== jobId || multiRef.current) return
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
      cancelWaitRef.current?.()
    })
    return () => {
      offProgress()
      offDone()
      offFailed()
    }
  }, [jobId])

  // Уход с экрана посреди расчёта оставлял процесс солвера крутиться до конца бюджета (до 60 с
  // на 100% CPU), а его результат — висеть черновиком в памяти main: jobId терялся вместе с
  // компонентом, и отменить расчёт становилось нечем.
  const abandonableJobRef = useRef<string | null>(null)
  useEffect(() => {
    abandonableJobRef.current = draft ? null : jobId
  }, [jobId, draft])
  useEffect(
    () => () => {
      const id = abandonableJobRef.current
      if (id) void api.invoke('generation:cancel', { jobId: id })
    },
    [],
  )

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

  /** Ждёт результат задания; null — задание упало или отменено. */
  function waitForJob(id: string): Promise<{ input: SolverInput; output: SolverOutput } | null> {
    return new Promise((resolve) => {
      const offDone = api.on('generation:done', (payload) => {
        if (payload.jobId !== id) return
        cleanup()
        resolve({ input: payload.input, output: payload.output })
      })
      const cleanup = () => {
        offDone()
        cancelWaitRef.current = null
      }
      cancelWaitRef.current = () => {
        cleanup()
        resolve(null)
      }
    })
  }

  async function handleStartPhases() {
    if (templateId === '' || !phaseReport) return
    const todo = phaseReport.phases.filter((p) => p.loads.length > 0)
    if (todo.length === 0) return notifyError('В семестре нет нагрузки, которую можно расставить')
    setDraft(null)
    setRuns([])
    setProgress(null)
    setStopping(false)
    multiRef.current = true
    abortChainRef.current = false

    const done: typeof runs = []
    let previous: string | undefined
    for (const phase of todo) {
      if (abortChainRef.current) break
      setCurrentPhase(phase)
      const res = await api.invoke('generation:start', { templateId, weekFrom: phase.weekFrom, weekTo: phase.weekTo, previousJobId: previous })
      if (!res.ok) {
        notifyError(res.error.message)
        abortChainRef.current = true
        break
      }
      setJobId(res.value.jobId)
      const result = await waitForJob(res.value.jobId)
      if (!result) {
        abortChainRef.current = true
        break
      }
      done.push({ phase, jobId: res.value.jobId, draft: result })
      previous = res.value.jobId
    }

    multiRef.current = false
    setCurrentPhase(null)
    if (abortChainRef.current) {
      // Уже посчитанные фазы без остальных применять нельзя — семестр остался бы с половиной версий.
      for (const r of done) await api.invoke('generation:cancel', { jobId: r.jobId })
      setJobId(null)
      setProgress(null)
      return
    }
    setRuns(done)
    setViewRun(0)
    setJobId(done.at(-1)!.jobId)
    setDraft(done[0]!.draft)
  }

  function showRun(i: number) {
    setViewRun(i)
    setDraft(runs[i]!.draft)
  }

  async function handleCancel() {
    if (!jobId) return
    abortChainRef.current = true
    cancelWaitRef.current?.()
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
    for (const r of runs) await api.invoke('generation:cancel', { jobId: r.jobId })
    setRuns([])
    if (jobId && runs.length === 0) await api.invoke('generation:cancel', { jobId })
    setJobId(null)
    setDraft(null)
  }

  async function handleApply() {
    if (!jobId) return
    setApplying(true)
    const res = runs.length > 0 ? await api.invoke('generation:applyPhases', { jobIds: runs.map((r) => r.jobId) }) : await api.invoke('generation:apply', { jobId })
    setApplying(false)
    if (!res.ok) {
      notifyError(res.error.message)
      return
    }
    notifySuccess(`Черновик применён: создано занятий — ${res.value.created}`)
    setJobId(null)
    setDraft(null)
    setRuns([])
    navigate('/schedule-template')
  }

  const generating = jobId != null && draft == null
  const unitsById = useMemo(() => new Map((draft?.input.units ?? []).map((u) => [u.id, u])), [draft])

  return (
    <div>
      <div className="page-header">
        <h1>Генерация расписания</h1>
        <div className="toolbar-actions">
          <FilterSelect
            label="Семестр"
            hint="Семестр, чьи версии шаблона доступны для расчёта"
            value={selectedSemesterId}
            onChange={(v) => setSemesterId(v === '' ? '' : Number(v))}
            disabled={generating}
          >
            <option value="">Выберите семестр</option>
            {semesters.map((s) => (
              <option key={s.id} value={s.id}>
                {semesterLabel(s.id)}
              </option>
            ))}
          </FilterSelect>
          <FilterSelect
            label="Версия шаблона"
            hint="Версия, в которую солвер разложит нераспределённую нагрузку"
            value={templateId}
            onChange={(v) => setTemplateId(v === '' ? '' : Number(v))}
            disabled={generating}
          >
            <option value="">Версия шаблона…</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                v{t.versionNo} · {t.status}
              </option>
            ))}
          </FilterSelect>
          {!generating && draft == null && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void handleStartPhases()}
              disabled={templateId === '' || !phaseReport || phaseReport.phases.every((p) => p.loads.length === 0)}
              title={templateId === '' ? 'Сначала выберите семестр и версию шаблона' : undefined}
            >
              Сгенерировать все фазы
            </button>
          )}
        </div>
      </div>

      {!generating && draft == null && streamCandidates > 0 && (
        <div className="card">
          <strong>Найдены лекции, которые можно читать потоком: {streamCandidates}</strong> — один преподаватель читает
          одну дисциплину нескольким группам отдельными строками. Пока они не объединены, каждая группа получит свою
          пару.{' '}
          <button type="button" className="btn-link" onClick={() => navigate('/streams')}>
            Объединить в потоки
          </button>
        </div>
      )}

      {!generating && draft == null && coverageWarnings.length > 0 && (
        <div className="card">
          <strong>Практика раньше, чем пройдены лекции</strong> — у этих дисциплин часть недель задана вручную, и программа
          их не переставляет (если недели не задавать, лекции сами идут первыми):
          <ul>
            {coverageWarnings.map((i) => (
              <li key={`${i.groupId}-${i.streamId}-${i.curriculumRowId}`}>{i.message}</li>
            ))}
          </ul>
        </div>
      )}

      {!generating && draft == null && phaseReport && (
        <div className="card">
          <strong>Фазы семестра</strong> — у каждой своя версия шаблона недели, с датой вступления в силу:
          <ol>
            {phaseReport.phases.map((p) => (
              <li key={p.no}>
                недели {p.weekFrom}–{p.weekTo} (с {p.effectiveFrom}): {p.loads.length === 0 ? 'нагрузки нет, фаза пропускается' : `${p.loads.length} строк нагрузки`}
                {p.startedBy.length > 0 && <small> · граница: {p.startedBy.join('; ')}</small>}
                {p.short && p.loads.length > 0 && <small> · одна неделя — подумайте, не склеить ли её с соседней, поправив недели у строки, давшей границу</small>}
              </li>
            ))}
          </ol>
          {phaseReport.problems.map((m) => (
            <p key={m} className="form-error">
              {m}
            </p>
          ))}
        </div>
      )}

      {!generating && draft == null && (
        <p className="history-empty">
          Солвер расставит нагрузку выбранной версии шаблона по сетке 36 слотов. Расчёт занимает до минуты, результат
          сначала показывается черновиком — в расписание он попадёт только после кнопки «Применить».
        </p>
      )}

      {generating && (
        <div className="card generation-progress">
          <span className="generation-progress-phase">
            {currentPhase ? `Фаза ${currentPhase.no} (недели ${currentPhase.weekFrom}–${currentPhase.weekTo}) · ` : ''}
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
          {runs.length > 0 && (
            <div className="btn-group" style={{ marginBottom: 12 }}>
              {runs.map((r, i) => (
                <button key={r.jobId} type="button" className={`btn${i === viewRun ? ' btn-primary' : ''}`} onClick={() => showRun(i)}>
                  Фаза {r.phase.no} · недели {r.phase.weekFrom}–{r.phase.weekTo}
                </button>
              ))}
            </div>
          )}
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
              {applying ? 'Применяю…' : runs.length > 1 ? 'Применить все фазы и открыть сетку' : 'Применить и открыть сетку'}
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
