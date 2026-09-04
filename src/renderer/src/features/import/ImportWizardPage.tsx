import { useEffect, useMemo, useRef, useState } from 'react'
import type { Curriculum, ImportApplyResult, ImportProfile, SheetInfo } from '../../../../shared/ipc/contract'
import {
  applyContextInheritance,
  collectDiscrepancies,
  filterServiceRows,
  mapToEntity,
  reconcileTotals,
  resolveDiscrepancies,
  TARGET_SCHEMAS,
  type Cell,
  type Grid,
  type TargetEntity,
} from '../../../../shared/import/engine'
import { api } from '../../api/client'
import { ConfirmDialog } from '../../ui/ConfirmDialog'
import { ruCommon } from '../../ui/locale'
import { useSemesterOptions } from '../load/useSemesterOptions'
import { notifyError, notifySuccess } from '../../ui/toast'
import { Select } from '../../ui/Select'

const TARGET_LABEL: Record<TargetEntity, string> = {
  curriculum: 'Учебный план (строки)',
  teaching_load: 'Нагрузка',
  teacher: 'Преподаватели',
  calendar_period: 'Календарный график',
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

function cellText(cell: Cell): string {
  return cell == null ? '' : String(cell)
}

interface ColumnConfig {
  field: string
  inherit: boolean
}

/**
 * Универсальный мастер импорта (§3.8): файл → лист → область данных → сопоставление
 * колонок → предпросмотр → применение. Разбор сетки — общие функции из
 * shared/import/engine.ts, поэтому предпросмотр пересчитывается локально при каждой
 * правке настройки, без обращения к main.
 */
export function ImportWizardPage() {
  const [step, setStep] = useState<1 | 2 | 3 | 4 | 5>(1)

  const [filePath, setFilePath] = useState<string | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [targetEntity, setTargetEntity] = useState<TargetEntity>('teacher')

  const [profiles, setProfiles] = useState<ImportProfile[]>([])
  const [profileId, setProfileId] = useState<number | ''>('')
  const [profileName, setProfileName] = useState('')

  const [sheets, setSheets] = useState<SheetInfo[]>([])
  const [sheetName, setSheetName] = useState<string | null>(null)
  const [grid, setGrid] = useState<Grid | null>(null)
  const [loadingGrid, setLoadingGrid] = useState(false)
  const sheetRequestRef = useRef(0)

  const [dataStartRow, setDataStartRow] = useState(1)
  const [dataEndRow, setDataEndRow] = useState<number | ''>('')

  const [columns, setColumns] = useState<ColumnConfig[]>([])
  const [servicePattern, setServicePattern] = useState('итого|всего')

  const [discrepancyKeyCol, setDiscrepancyKeyCol] = useState<number | ''>('')
  const [discrepancyValueCol, setDiscrepancyValueCol] = useState<number | ''>('')
  const [discrepancyResolutions, setDiscrepancyResolutions] = useState<Record<string, string>>({})

  const [curricula, setCurricula] = useState<Curriculum[]>([])
  const { semesters, label: semesterLabel } = useSemesterOptions()
  const [curriculumId, setCurriculumId] = useState<number | ''>('')
  const [semesterId, setSemesterId] = useState<number | ''>('')
  const [validFrom, setValidFrom] = useState(todayIso())

  const [pendingProfileDelete, setPendingProfileDelete] = useState<ImportProfile | null>(null)

  const [applying, setApplying] = useState(false)
  const [applyResult, setApplyResult] = useState<ImportApplyResult | null>(null)

  useEffect(() => {
    void api.invoke('import:profiles:list', { targetEntity }).then((res) => res.ok && setProfiles(res.value))
  }, [targetEntity])

  useEffect(() => {
    if (targetEntity === 'curriculum') void api.invoke('curricula:list', { includeArchived: true }).then((res) => res.ok && setCurricula(res.value))
  }, [targetEntity])

  const selectedProfile = profileId === '' ? null : (profiles.find((p) => p.id === profileId) ?? null)
  const fields = TARGET_SCHEMAS[targetEntity]
  // По самой широкой строке, а не по первой: у реальных файлов верхние строки — заголовок
  // в объединённых ячейках, и по нему колонок насчитывалось меньше, чем в данных.
  const columnCount = useMemo(() => (grid ?? []).reduce((max, row) => Math.max(max, row.length), 0), [grid])

  function resetForNewFile() {
    setSheets([])
    setSheetName(null)
    setGrid(null)
    setColumns([])
    setApplyResult(null)
  }

  async function pickFile() {
    const res = await api.invoke('import:pickFile', {})
    if (!res.ok) return notifyError(res.error.message)
    if ('cancelled' in res.value) return
    setFilePath(res.value.filePath)
    setFileName(res.value.fileName)
    resetForNewFile()
    const sheetsRes = await api.invoke('import:listSheets', { filePath: res.value.filePath })
    if (sheetsRes.ok) setSheets(sheetsRes.value)
    else notifyError(sheetsRes.error.message)
  }

  function applyProfile(id: number) {
    const p = profiles.find((x) => x.id === id)
    if (!p) return
    try {
      const saved = JSON.parse(p.mappingJson) as { dataStartRow: number; dataEndRow: number | null; columns: ColumnConfig[]; servicePattern: string }
      setDataStartRow(saved.dataStartRow)
      setDataEndRow(saved.dataEndRow ?? '')
      setColumns(saved.columns)
      setServicePattern(saved.servicePattern)
    } catch {
      notifyError('Профиль повреждён — сопоставление не загружено')
    }
  }

  async function selectSheet(name: string) {
    if (!filePath) return
    // Листы читаются с разной скоростью: без токена ответ по ранее выбранному большому листу
    // приходил после ответа по маленькому и подменял сетку, не совпадающую с `sheetName`.
    const reqId = ++sheetRequestRef.current
    setSheetName(name)
    setLoadingGrid(true)
    const res = await api.invoke('import:readGrid', { filePath, sheetName: name })
    if (reqId !== sheetRequestRef.current) return
    setLoadingGrid(false)
    if (res.ok) {
      setGrid(res.value)
      setColumns((prev) => {
        const width = res.value.reduce((max, row) => Math.max(max, row.length), 0)
        if (prev.length === width) return prev
        return Array.from({ length: width }, (_, i) => prev[i] ?? { field: '', inherit: false })
      })
    } else {
      notifyError(res.error.message)
    }
  }

  // --- предпросмотр: пересчитывается локально из shared/import/engine.ts при любой правке ---

  const rangedGrid: Grid = useMemo(() => {
    if (!grid) return []
    const start = Math.max(1, dataStartRow) - 1
    const end = dataEndRow === '' ? grid.length : dataEndRow
    return grid.slice(start, end)
  }, [grid, dataStartRow, dataEndRow])

  const inheritColumnIndexes = useMemo(() => columns.map((c, i) => (c.inherit ? i : -1)).filter((i) => i >= 0), [columns])

  // Строки «Итого» отсеиваются ДО наследования контекста: иначе значения контрольной строки
  // запоминались как контекст и протекали в следующие строки данных (§3.8a/§3.8b).
  // `filterServiceRows` компилирует `new RegExp` — недописанный шаблон («итого|всего(») бросал
  // SyntaxError прямо в фазе рендера и уносил всё дерево вместе с настройками мастера.
  const serviceFilter = useMemo(() => {
    try {
      return { ...filterServiceRows(rangedGrid, servicePattern), patternError: null as string | null }
    } catch (error) {
      return {
        dataRows: rangedGrid,
        controlRows: [] as Grid,
        patternError: error instanceof Error ? error.message : 'некорректное регулярное выражение',
      }
    }
  }, [rangedGrid, servicePattern])
  const { controlRows, patternError } = serviceFilter
  const dataRows = useMemo(
    () => applyContextInheritance(serviceFilter.dataRows, inheritColumnIndexes),
    [serviceFilter, inheritColumnIndexes],
  )

  /**
   * Подпись колонки из шапки самого файла. Без неё на шаге 4 колонки называются
   * «Колонка 1…13», а первая колонка листа в реальных файлах часто пустая (поле
   * страницы) — завучу приходилось считать смещение в уме и сопоставлять вслепую.
   * Берём последнее непустое значение выше строки данных: шапка бывает двухуровневой,
   * и нижний уровень («Часы», «Код вида») точнее верхнего («Кол-во часов I полугодие»).
   */
  const headerHints = useMemo(() => {
    if (!grid) return []
    const above = grid.slice(0, Math.max(0, dataStartRow - 1))
    return Array.from({ length: columnCount }, (_, c) => {
      for (let r = above.length - 1; r >= 0; r--) {
        const text = cellText(above[r]?.[c] ?? null)
        if (text !== '') return text
      }
      return ''
    })
  }, [grid, dataStartRow, columnCount])

  const columnLabel = (c: number): string => (headerHints[c] ? `Колонка ${c + 1} — ${headerHints[c]}` : `Колонка ${c + 1}`)

  const columnMapping = useMemo(() => columns.map((c, i) => ({ columnIndex: i, field: c.field })).filter((c) => c.field !== ''), [columns])
  const numericFieldColumns = useMemo(
    () => columnMapping.filter((c) => dataRows.some((r) => typeof r[c.columnIndex] === 'number')).map((c) => c.columnIndex),
    [columnMapping, dataRows],
  )
  const reconciliation = useMemo(() => reconcileTotals(dataRows, controlRows, numericFieldColumns), [dataRows, controlRows, numericFieldColumns])

  const discrepancies = useMemo(
    () => (discrepancyKeyCol !== '' && discrepancyValueCol !== '' ? collectDiscrepancies(dataRows, [discrepancyKeyCol], discrepancyValueCol) : []),
    [dataRows, discrepancyKeyCol, discrepancyValueCol],
  )
  const unresolvedDiscrepancies = discrepancies.filter((d) => discrepancyResolutions[d.key] == null)

  const resolvedDataRows = useMemo(
    () => (discrepancyValueCol !== '' && discrepancyKeyCol !== '' ? resolveDiscrepancies(dataRows, [discrepancyKeyCol], discrepancyValueCol, discrepancyResolutions) : dataRows),
    [dataRows, discrepancyKeyCol, discrepancyValueCol, discrepancyResolutions],
  )

  const mappedRows = useMemo(() => mapToEntity(resolvedDataRows, columnMapping), [resolvedDataRows, columnMapping])

  const missingRequiredFields = fields.filter((f) => f.required && !columns.some((c) => c.field === f.field))

  const canApply =
    missingRequiredFields.length === 0 &&
    unresolvedDiscrepancies.length === 0 &&
    mappedRows.length > 0 &&
    (targetEntity !== 'curriculum' || curriculumId !== '') &&
    (targetEntity !== 'teaching_load' || semesterId !== '')

  /**
   * Сохранение сопоставления профилем (§3.8d). `update = true` правит выбранный профиль
   * («формат изменился»), иначе создаётся новый — без этого повторная настройка того же
   * файла плодила бы одноимённые профили вместо правки существующего.
   */
  async function saveProfile(update: boolean) {
    const selected = update ? profiles.find((p) => p.id === profileId) : undefined
    if (update && !selected) return
    const name = profileName.trim() === '' ? (selected?.name ?? '') : profileName.trim()
    if (name === '') return
    const mappingJson = JSON.stringify({ dataStartRow, dataEndRow: dataEndRow === '' ? null : dataEndRow, columns, servicePattern })
    const res = await api.invoke('import:profiles:save', {
      id: selected?.id,
      rowVersion: selected?.rowVersion,
      name,
      targetEntity,
      mappingJson,
    })
    if (res.ok) {
      notifySuccess(selected ? 'Профиль обновлён' : 'Профиль сохранён')
      setProfiles((prev) => [...prev.filter((p) => p.id !== res.value.id), res.value])
      setProfileId(res.value.id)
      setProfileName('')
    } else {
      notifyError(res.error.message)
    }
  }

  /**
   * Удаление профиля (§3.8d). Канал `import:profiles:delete` был в контракте с самого
   * начала, но из мастера не вызывался: ошибочно сохранённое сопоставление оставалось
   * в списке навсегда, и отличить его от рабочего можно было только по имени.
   */
  async function deleteProfile(profile: ImportProfile) {
    const res = await api.invoke('import:profiles:delete', { id: profile.id })
    setPendingProfileDelete(null)
    if (!res.ok) return notifyError(res.error.message)

    notifySuccess(`Профиль «${profile.name}» удалён`)
    setProfiles((prev) => prev.filter((p) => p.id !== profile.id))
    // Настройки остаются на экране — удалён профиль, а не разметка, которую завуч уже
    // видит в предпросмотре; сбрасывается только привязка к исчезнувшей записи.
    if (profileId === profile.id) setProfileId('')
  }

  async function apply() {
    setApplying(true)
    const res = await api.invoke('import:apply', {
      targetEntity,
      rows: mappedRows,
      curriculumId: targetEntity === 'curriculum' && curriculumId !== '' ? curriculumId : undefined,
      semesterId: targetEntity === 'teaching_load' && semesterId !== '' ? semesterId : undefined,
      validFrom,
    })
    setApplying(false)
    if (res.ok) {
      setApplyResult(res.value)
      notifySuccess(`Импорт применён (операция #${res.value.operationId}) — создано ${res.value.created}, отменить можно в разделе «Операции»`)
    } else {
      notifyError(res.error.message)
    }
  }

  return (
    <div>
      <div className="page-header">
        <h1>Импорт из Excel</h1>
        <div className="toolbar-actions">
          <span className="badge">Шаг {step} из 5</span>
        </div>
      </div>

      {step === 1 && (
        <div className="card">
          <h3>1. Файл и целевая сущность</h3>
          <div className="form-field">
            <label>Файл</label>
            <div className="btn-group">
              <button type="button" className="btn" onClick={() => void pickFile()}>
                Выбрать файл…
              </button>
              <span>{fileName ?? 'Файл не выбран'}</span>
            </div>
          </div>
          <div className="form-field">
            <label htmlFor="target-entity">Куда импортировать</label>
            <Select
              id="target-entity"
              value={targetEntity}
              onChange={(v) => {
                setTargetEntity(v as TargetEntity)
                setColumns((prev) => prev.map(() => ({ field: '', inherit: false })))
                setProfileId('')
              }}
            >
              {Object.entries(TARGET_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </div>
          {profiles.length > 0 && (
            <div className="form-field">
              <label htmlFor="import-profile">Профиль сопоставления (§3.8d)</label>
              <div className="btn-group">
                <Select
                  id="import-profile"
                  value={profileId}
                  onChange={(v) => {
                    const id = v === '' ? '' : Number(v)
                    setProfileId(id)
                    if (id !== '') applyProfile(id)
                  }}
                >
                  <option value="">Без профиля — настроить заново</option>
                  {profiles.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
                <button
                  type="button"
                  className="btn btn-danger"
                  disabled={selectedProfile == null}
                  onClick={() => selectedProfile && setPendingProfileDelete(selectedProfile)}
                >
                  {ruCommon.delete}
                </button>
              </div>
            </div>
          )}
          <div className="dialog-actions">
            <button type="button" className="btn btn-primary" disabled={sheets.length === 0} onClick={() => setStep(2)}>
              Далее →
            </button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="card">
          <h3>2. Лист</h3>
          {sheets.map((s) => (
            <div className="form-field-checkbox" key={s.name}>
              <input id={`sheet-${s.name}`} type="radio" checked={sheetName === s.name} onChange={() => void selectSheet(s.name)} />
              <label htmlFor={`sheet-${s.name}`}>
                {s.name} ({s.rowCount}×{s.columnCount})
              </label>
            </div>
          ))}
          {loadingGrid && <p className="history-empty">Загрузка листа…</p>}
          <div className="dialog-actions">
            <button type="button" className="btn" onClick={() => setStep(1)}>
              ← Назад
            </button>
            <button type="button" className="btn btn-primary" disabled={!grid} onClick={() => setStep(3)}>
              Далее →
            </button>
          </div>
        </div>
      )}

      {step === 3 && grid && (
        <div className="card">
          <h3>3. Область данных</h3>
          <div className="form-field">
            <label>Первая строка данных</label>
            <input type="number" min={1} max={grid.length} value={dataStartRow} onChange={(e) => setDataStartRow(Number(e.target.value))} />
          </div>
          <div className="form-field">
            <label>Последняя строка данных (пусто — до конца листа)</label>
            <input
              type="number"
              min={dataStartRow}
              max={grid.length}
              value={dataEndRow}
              onChange={(e) => setDataEndRow(e.target.value === '' ? '' : Number(e.target.value))}
            />
          </div>
          <div className="data-table-wrap" style={{ maxHeight: 360, overflow: 'auto' }}>
            <table className="data-table">
              <tbody>
                {grid.slice(0, 60).map((row, idx) => {
                  const rowNo = idx + 1
                  const inRange = rowNo >= dataStartRow && (dataEndRow === '' || rowNo <= dataEndRow)
                  return (
                    <tr key={rowNo} className={inRange ? '' : 'archived-row'}>
                      <td>
                        <strong>{rowNo}</strong>
                      </td>
                      {Array.from({ length: columnCount }, (_, c) => (
                        <td key={c}>{cellText(row[c] ?? null)}</td>
                      ))}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className="history-empty">Строк в выбранном диапазоне: {rangedGrid.length}. Показаны первые 60 строк листа, все {columnCount} колонок — таблица прокручивается вбок.</p>
          <div className="dialog-actions">
            <button type="button" className="btn" onClick={() => setStep(2)}>
              ← Назад
            </button>
            <button type="button" className="btn btn-primary" onClick={() => setStep(4)}>
              Далее →
            </button>
          </div>
        </div>
      )}

      {step === 4 && grid && (
        <div className="card">
          <h3>4. Сопоставление колонок</h3>
          <p className="history-empty">
            Нужны поля: {fields.map((f) => `${f.labelRu}${f.required ? '' : ' (необязательно)'}`).join(', ')}
            {missingRequiredFields.length > 0 && (
              <span className="badge badge-warning" style={{ marginLeft: 8 }}>
                не сопоставлено: {missingRequiredFields.map((f) => f.labelRu).join(', ')}
              </span>
            )}
          </p>
          <div className="data-table-wrap" style={{ overflow: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>#</th>
                  {Array.from({ length: columnCount }, (_, c) => (
                    <th key={c}>
                      Колонка {c + 1}
                      {headerHints[c] ? <div className="history-empty">{headerHints[c]}</div> : null}
                    </th>
                  ))}
                </tr>
                <tr>
                  <th>Поле</th>
                  {Array.from({ length: columnCount }, (_, c) => (
                    <th key={c}>
                      <Select
                        value={columns[c]?.field ?? ''}
                        onChange={(v) =>
                          setColumns((prev) => prev.map((col, i) => (i === c ? { ...col, field: v } : col)))
                        }
                      >
                        <option value="">—</option>
                        {fields.map((f) => (
                          <option key={f.field} value={f.field}>
                            {f.labelRu}
                          </option>
                        ))}
                      </Select>
                    </th>
                  ))}
                </tr>
                <tr>
                  <th>Наследовать (§3.8a)</th>
                  {Array.from({ length: columnCount }, (_, c) => (
                    <th key={c}>
                      <input
                        type="checkbox"
                        checked={columns[c]?.inherit ?? false}
                        onChange={(e) =>
                          setColumns((prev) => prev.map((col, i) => (i === c ? { ...col, inherit: e.target.checked } : col)))
                        }
                      />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rangedGrid.slice(0, 8).map((row, idx) => (
                  <tr key={idx}>
                    <td>образец</td>
                    {Array.from({ length: columnCount }, (_, c) => (
                      <td key={c}>{cellText(row[c] ?? null)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="form-field" style={{ marginTop: 12 }}>
            <label>Правило служебных строк «Итого/ВСЕГО» (§3.8b, регулярное выражение)</label>
            <input
              type="text"
              value={servicePattern}
              onChange={(e) => setServicePattern(e.target.value)}
              aria-invalid={patternError != null}
            />
            {patternError && <span className="form-error">Правило не применено: {patternError}</span>}
          </div>
          <p className="history-empty">
            Строк данных: {dataRows.length}, строк-сумм: {controlRows.length}
          </p>

          <div className="dialog-actions">
            <button type="button" className="btn" onClick={() => setStep(3)}>
              ← Назад
            </button>
            <button type="button" className="btn btn-primary" onClick={() => setStep(5)}>
              Далее →
            </button>
          </div>
        </div>
      )}

      {pendingProfileDelete && (
        <ConfirmDialog
          open
          title={`Удалить профиль «${pendingProfileDelete.name}»?`}
          description={ruCommon.confirmDeleteBody}
          confirmLabel={ruCommon.yesDelete}
          danger
          onConfirm={() => void deleteProfile(pendingProfileDelete)}
          onCancel={() => setPendingProfileDelete(null)}
        />
      )}

      {step === 5 && grid && (
        <div className="card">
          <h3>5. Предпросмотр и применение</h3>

          {reconciliation.length > 0 && (
            <>
              <h4>Сверка контрольных сумм</h4>
              <ul>
                {reconciliation.map((r) => (
                  <li key={r.columnIndex} className={r.matches ? undefined : 'overlap-warning'}>
                    {columnLabel(r.columnIndex)}: данные {r.dataSum}, «Итого» {r.controlSum} {r.matches ? '— совпадает' : '— расхождение'}
                  </li>
                ))}
              </ul>
            </>
          )}

          <h4>Проверка расхождений (§3.8c, необязательно)</h4>
          <div className="btn-group">
            <Select value={discrepancyKeyCol} onChange={(v) => setDiscrepancyKeyCol(v === '' ? '' : Number(v))}>
              <option value="">Ключевая колонка…</option>
              {Array.from({ length: columnCount }, (_, c) => (
                <option key={c} value={c}>
                  {columnLabel(c)}
                </option>
              ))}
            </Select>
            <Select value={discrepancyValueCol} onChange={(v) => setDiscrepancyValueCol(v === '' ? '' : Number(v))}>
              <option value="">Проверяемая колонка…</option>
              {Array.from({ length: columnCount }, (_, c) => (
                <option key={c} value={c}>
                  {columnLabel(c)}
                </option>
              ))}
            </Select>
          </div>
          {discrepancies.length === 0 && discrepancyKeyCol !== '' && discrepancyValueCol !== '' && (
            <p className="history-empty">Расхождений не найдено</p>
          )}
          {discrepancies.map((d) => (
            <div key={d.key} className="subpanel-row">
              <span>
                «{d.key}»: {d.values.map((v) => `${v.value} в ${v.count} строках`).join(', ')}
              </span>
              <Select
                value={discrepancyResolutions[d.key] ?? ''}
                onChange={(v) => setDiscrepancyResolutions((prev) => ({ ...prev, [d.key]: v }))}
              >
                <option value="">Выбрать значение…</option>
                {d.values.map((v) => (
                  <option key={v.value} value={v.value}>
                    {v.value}
                  </option>
                ))}
              </Select>
            </div>
          ))}
          {unresolvedDiscrepancies.length > 0 && (
            <p className="overlap-warning">Разрешите все расхождения ({unresolvedDiscrepancies.length}), прежде чем применять импорт.</p>
          )}

          {targetEntity === 'curriculum' && (
            <div className="form-field">
              <label>Учебный план</label>
              <Select value={curriculumId} onChange={(v) => setCurriculumId(v === '' ? '' : Number(v))}>
                <option value="">—</option>
                {curricula.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </div>
          )}
          {targetEntity === 'teaching_load' && (
            <div className="form-field">
              <label>Семестр</label>
              <Select value={semesterId} onChange={(v) => setSemesterId(v === '' ? '' : Number(v))}>
                <option value="">—</option>
                {semesters.map((s) => (
                  <option key={s.id} value={s.id}>
                    {semesterLabel(s.id)}
                  </option>
                ))}
              </Select>
            </div>
          )}
          <div className="form-field">
            <label>Действует с</label>
            <input type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} />
          </div>

          <p>
            <strong>Будет создано записей: {mappedRows.length}</strong>
          </p>

          <div className="form-field">
            <label>Сохранить сопоставление как профиль (§3.8d)</label>
            <div className="btn-group">
              <input type="text" value={profileName} onChange={(e) => setProfileName(e.target.value)} placeholder="Название профиля" />
              <button type="button" className="btn" disabled={profileName.trim() === ''} onClick={() => void saveProfile(false)}>
                Сохранить как новый
              </button>
              {selectedProfile && (
                <button type="button" className="btn" onClick={() => void saveProfile(true)}>
                  Обновить «{selectedProfile.name}»
                </button>
              )}
            </div>
          </div>

          {applyResult && (
            <div className="subpanel">
              <h3>Результат импорта</h3>
              <p>Создано: {applyResult.created}</p>
              {applyResult.skipped.length > 0 && (
                <>
                  <p>Пропущено: {applyResult.skipped.length}</p>
                  <ul>
                    {applyResult.skipped.slice(0, 20).map((s, i) => (
                      <li key={i} className="overlap-warning">
                        {s.reason}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}

          <div className="dialog-actions">
            <button type="button" className="btn" onClick={() => setStep(4)}>
              ← Назад
            </button>
            {/* `import:apply` не идемпотентен: повторное нажатие создало бы второй комплект строк.
                После успеха шаг 5 становится терминальным — дальше только новый файл. */}
            {applyResult ? (
              <button type="button" className="btn btn-primary" onClick={() => {
                  resetForNewFile()
                  setStep(1)
                }}>
                Импортировать ещё файл
              </button>
            ) : (
              <button type="button" className="btn btn-primary" disabled={!canApply || applying} onClick={() => void apply()}>
                {applying ? 'Применяем…' : 'Применить'}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
