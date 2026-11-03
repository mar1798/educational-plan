import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Discipline, GridImportPlanView, SheetInfo } from '../../../../shared/ipc/contract'
import { api } from '../../api/client'
import { WEEKDAY_LABEL } from '../../ui/locale'
import { Select } from '../../ui/Select'
import { notifyError, notifySuccess } from '../../ui/toast'
import { useSemesterOptions } from '../load/useSemesterOptions'

/**
 * Загрузка готового расписания из файла формата колледжа (§этап Ж): файл → лист → предпросмотр
 * распознанной сетки → проблемы и привязка сокращений → загрузка. Что именно распознано и как
 * сопоставлено, решает main; здесь только показ и выбор.
 */
export function GridImportPage() {
  const navigate = useNavigate()
  const { semesters, label: semesterLabel } = useSemesterOptions()
  const [semesterId, setSemesterId] = useState<number | ''>('')
  const [file, setFile] = useState<{ filePath: string; fileName: string } | null>(null)
  const [sheets, setSheets] = useState<SheetInfo[]>([])
  const [sheetName, setSheetName] = useState('')
  const [headerRow, setHeaderRow] = useState('')
  const [bindings, setBindings] = useState<Record<string, number>>({})
  const [disciplines, setDisciplines] = useState<Discipline[]>([])
  const [plan, setPlan] = useState<GridImportPlanView | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void api.invoke('disciplines:list', {}).then((res) => (res.ok ? setDisciplines(res.value) : notifyError(res.error.message)))
  }, [])

  const request = () => ({
    filePath: file!.filePath,
    sheetName,
    semesterId: semesterId as number,
    bindings,
    headerRow: headerRow.trim() === '' ? undefined : Number(headerRow),
  })

  async function pickFile() {
    const res = await api.invoke('import:pickFile', {})
    if (!res.ok) return notifyError(res.error.message)
    if ('cancelled' in res.value) return
    setFile(res.value)
    setPlan(null)
    setBindings({})
    const list = await api.invoke('import:listSheets', { filePath: res.value.filePath })
    if (!list.ok) return notifyError(list.error.message)
    setSheets(list.value)
    setSheetName(list.value[0]?.name ?? '')
  }

  async function preview() {
    if (!file || semesterId === '' || sheetName === '') return
    setBusy(true)
    const res = await api.invoke('import:gridPreview', request())
    setBusy(false)
    if (res.ok) setPlan(res.value)
    else notifyError(res.error.message)
  }

  async function apply() {
    setBusy(true)
    const res = await api.invoke('import:gridApply', request())
    setBusy(false)
    if (!res.ok) return notifyError(res.error.message)
    notifySuccess(`Загружено записей: ${res.value.created}. Они закреплены в черновике шаблона — проверьте их в редакторе.`)
    navigate(`/schedule-template?semester=${semesterId}&template=${res.value.templateId}`)
  }

  const canPreview = file != null && semesterId !== '' && sheetName !== ''

  return (
    <div>
      <div className="page-header">
        <h1>Загрузка расписания из файла</h1>
      </div>
      <p className="history-empty">
        Файл в формате колледжа: слева день и время, сверху группы. Занятия встанут в новую черновую версию шаблона как закреплённые — солвер достроит остальное, не сдвигая загруженное.
      </p>

      <div className="toolbar-actions" style={{ marginBottom: 12 }}>
        <Select id="grid-semester" value={semesterId} onChange={(v) => setSemesterId(v === '' ? '' : Number(v))}>
          <option value="">Семестр…</option>
          {semesters.map((s) => (
            <option key={s.id} value={s.id}>
              {semesterLabel(s.id)}
            </option>
          ))}
        </Select>
        <button type="button" className="btn" onClick={() => void pickFile()}>
          {file ? `Файл: ${file.fileName}` : 'Выбрать файл…'}
        </button>
        {sheets.length > 0 && (
          <Select
            id="grid-sheet"
            value={sheetName}
            onChange={(v) => {
              setSheetName(v)
              setPlan(null)
            }}
          >
            {sheets.map((s) => (
              <option key={s.name} value={s.name}>
                {s.name}
              </option>
            ))}
          </Select>
        )}
        <input type="number" min={1} placeholder="Строка шапки (если не нашлась)" style={{ width: 220 }} value={headerRow} onChange={(e) => setHeaderRow(e.target.value)} />
        <button type="button" className="btn btn-primary" disabled={!canPreview || busy} onClick={() => void preview()}>
          Распознать
        </button>
      </div>

      {plan && (
        <div className="card">
          <p>
            Шапка в строке {plan.layout.headerRow}; групп распознано: {plan.layout.groups.length}; занятых ячеек: {plan.layout.cellsCount}; будет загружено записей:{' '}
            <strong>{plan.entries.length}</strong>.
          </p>
          {plan.layout.unknownHeaders.length > 0 && <p className="form-error">Заголовки, не совпавшие с группами справочника, пропущены: {plan.layout.unknownHeaders.join(', ')}</p>}

          {plan.unknownAbbreviations.length > 0 && (
            <>
              <h3>Неизвестные сокращения — привяжите к дисциплинам</h3>
              {plan.unknownAbbreviations.map((u) => (
                <div className="form-field" key={u.abbr}>
                  <label>
                    «{u.abbr}» ({u.count} яч.)
                  </label>
                  <Select
                    id={`bind-${u.abbr}`}
                    value={bindings[u.abbr] ?? ''}
                    onChange={(v) => setBindings((prev) => (v === '' ? Object.fromEntries(Object.entries(prev).filter(([k]) => k !== u.abbr)) : { ...prev, [u.abbr]: Number(v) }))}
                  >
                    <option value="">—</option>
                    {[
                      ...u.suggestions.map((s) => disciplines.find((d) => d.id === s.id)).filter((d): d is Discipline => d != null),
                      ...disciplines.filter((d) => !u.suggestions.some((s) => s.id === d.id)),
                    ].map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </Select>
                </div>
              ))}
              <button type="button" className="btn" disabled={busy} onClick={() => void preview()}>
                Пересчитать с привязками
              </button>
            </>
          )}

          {plan.problems.length > 0 && (
            <details open={plan.problems.length < 15}>
              <summary>Не будет загружено ({plan.problems.length}) — причины</summary>
              <ul>
                {plan.problems.map((p, i) => (
                  <li key={i}>
                    Строка {p.row}, {p.groupName} «{p.text}»: {p.reason}
                  </li>
                ))}
              </ul>
            </details>
          )}

          {plan.conflicts.length > 0 && (
            <details>
              <summary>Конфликты внутри файла ({plan.conflicts.length}) — записи загрузятся, исправьте их в редакторе</summary>
              <ul>
                {plan.conflicts.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </details>
          )}

          {plan.entries.length > 0 && (
            <details>
              <summary>Что будет загружено</summary>
              <ul>
                {plan.entries.slice(0, 200).map((e, i) => (
                  <li key={i}>
                    {WEEKDAY_LABEL[e.dayOfWeek]}, пара {e.pairNo}: {e.label}
                  </li>
                ))}
              </ul>
            </details>
          )}

          <div className="btn-group" style={{ marginTop: 12 }}>
            <button type="button" className="btn btn-primary" disabled={busy || plan.entries.length === 0} onClick={() => void apply()}>
              Загрузить {plan.entries.length} записей
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
