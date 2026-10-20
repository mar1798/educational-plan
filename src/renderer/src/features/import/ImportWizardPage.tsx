import { useEffect, useMemo, useRef, useState } from 'react'
import type { Curriculum, ImportApplyResult, ImportProfile, SheetInfo } from '../../../../shared/ipc/contract'
import {
  applyBlockHeaders,
  applyContextInheritance,
  collectDiscrepancies,
  columnHeaderHints,
  coveredFields,
  filterServiceRows,
  guessColumnConstants,
  mapToEntity,
  reconcileTotals,
  resolveDiscrepancies,
  TARGET_SCHEMAS,
  unpivotFields,
  type BlockHeaderRule,
  type Cell,
  type Grid,
  type TargetEntity,
} from '../../../../shared/import/engine'
import { IMPORT_PRESETS, type ColumnConfig, type SavedMapping } from '../../../../shared/import/presets'
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

/**
 * Буква колонки как в Excel. Мастер подписывал колонки «Колонка 1…35», а завуч видит в
 * файле A, B, C — при пустой колонке A «Колонка 2» оказывалась B, и смещение считали в уме.
 */
function columnLetter(index: number): string {
  let n = index + 1
  let letters = ''
  while (n > 0) {
    const m = (n - 1) % 26
    letters = String.fromCharCode(65 + m) + letters
    n = Math.floor((n - 1) / 26)
  }
  return letters
}

/** Готовые условия строки-заголовка: завучу не нужно писать регулярные выражения руками. */
const HEADER_CONDITIONS = [
  { pattern: '^\\d+$', label: 'число (номер цикла, раздела)' },
  { pattern: '', label: 'любое непустое значение' },
] as const

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
  const [presetKey, setPresetKey] = useState('')
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
  const [headerRules, setHeaderRules] = useState<BlockHeaderRule[]>([])
  // Правила, где завуч выбрал «своё выражение». Из самого шаблона режим не вывести: пока
  // выражение совпадает с готовым условием («^\d+$»), список возвращался на «число», и
  // поле для выражения не появлялось.
  const [customHeaderRules, setCustomHeaderRules] = useState<Set<number>>(new Set())

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
  const presets = IMPORT_PRESETS.filter((p) => p.targetEntity === targetEntity)
  const selectedPreset = presets.find((p) => p.key === presetKey) ?? null
  const fields = TARGET_SCHEMAS[targetEntity]
  // По самой широкой строке, а не по первой: у реальных файлов верхние строки — заголовок
  // в объединённых ячейках, и по нему колонок насчитывалось меньше, чем в данных.
  const columnCount = useMemo(() => (grid ?? []).reduce((max, row) => Math.max(max, row.length), 0), [grid])

  function resetForNewFile() {
    setSheets([])
    setSheetName(null)
    setGrid(null)
    // Выбранный профиль описывает, как читать файл, — он переживает смену файла; без
    // профиля прежняя разметка к новому файлу отношения не имеет.
    if (profileId === '' && presetKey === '') setColumns([])
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

  function applyMapping(saved: SavedMapping) {
    setDataStartRow(saved.dataStartRow)
    setDataEndRow(saved.dataEndRow ?? '')
    // Сопоставление короче листа (готовый профиль описывает только нужные колонки) —
    // добиваем пустыми, иначе правка колонки за его пределами терялась бы.
    const width = Math.max(saved.columns.length, columnCount)
    setColumns(Array.from({ length: width }, (_, i) => saved.columns[i] ?? { field: '', inherit: false }))
    setServicePattern(saved.servicePattern)
    // Профили до строк-заголовков и проверки расхождений их не хранили — это не ошибка.
    setHeaderRules(saved.headerRules ?? [])
    setCustomHeaderRules(new Set())
    setDiscrepancyKeyCol(saved.discrepancy?.keyColumn ?? '')
    setDiscrepancyValueCol(saved.discrepancy?.valueColumn ?? '')
    setDiscrepancyResolutions({})
  }

  function applyProfile(id: number) {
    const p = profiles.find((x) => x.id === id)
    if (!p) return
    try {
      applyMapping(JSON.parse(p.mappingJson) as SavedMapping)
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
  const inheritedRows = useMemo(
    () => applyContextInheritance(serviceFilter.dataRows, inheritColumnIndexes),
    [serviceFilter, inheritColumnIndexes],
  )
  // Правило с недописанным выражением не применяется, а подсвечивается — как и правило
  // служебных строк выше: исключение в фазе рендера унесло бы все настройки мастера.
  const headerRuleErrors = useMemo(
    () =>
      headerRules.map((r) => {
        try {
          new RegExp(r.pattern, 'i')
          return null
        } catch (error) {
          return error instanceof Error ? error.message : 'некорректное выражение'
        }
      }),
    [headerRules],
  )
  const blocks = useMemo(
    () => applyBlockHeaders(inheritedRows, headerRules.filter((r, i) => r.field !== '' && headerRuleErrors[i] == null)),
    [inheritedRows, headerRules, headerRuleErrors],
  )
  const dataRows = blocks.dataRows

  const headerHints = useMemo(() => (grid ? columnHeaderHints(grid, dataStartRow, columnCount) : []), [grid, dataStartRow, columnCount])

  const columnLabel = (c: number): string => (headerHints[c] ? `${columnLetter(c)} — ${headerHints[c]}` : columnLetter(c))

  const columnMapping = useMemo(
    () => columns.map((c, i) => ({ columnIndex: i, field: c.field, constants: c.constants })).filter((c) => c.field !== ''),
    [columns],
  )
  const valueFields = useMemo(() => unpivotFields(columnMapping), [columnMapping])
  const activeHeaderRules = useMemo(() => headerRules.filter((r) => r.field !== ''), [headerRules])
  /**
   * Признаки, которые задаются у колонок-значений: поля сущности, не взятые ни из своей
   * колонки, ни из строки-заголовка. Для нагрузки это обычно вид занятия и полугодие.
   */
  const constantFields = useMemo(
    () =>
      fields.filter(
        (f) =>
          !valueFields.has(f.field) &&
          !columnMapping.some((c) => c.field === f.field) &&
          !activeHeaderRules.some((r) => r.field === f.field),
      ),
    [fields, valueFields, columnMapping, activeHeaderRules],
  )
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

  const mappedRows = useMemo(() => mapToEntity(resolvedDataRows, columnMapping, blocks.contexts), [resolvedDataRows, columnMapping, blocks])

  const covered = coveredFields(columnMapping, activeHeaderRules)
  const missingRequiredFields = fields.filter((f) => f.required && !covered.has(f.field))
  const halfYearCovered = covered.has('halfYear')

  /**
   * Смена поля колонки. Когда поле получает вторую колонку, обе становятся колонками-
   * значениями (mapToEntity), и мастер сразу подставляет им признаки из шапки — вид
   * занятия и полугодие, которые в «широкой» таблице записаны именно там.
   */
  function setColumnField(index: number, field: string) {
    setColumns((prev) => {
      const next = prev.map((col, i) => (i === index ? { ...col, field } : col))
      const counts = new Map<string, number>()
      for (const col of next) if (col.field !== '') counts.set(col.field, (counts.get(col.field) ?? 0) + 1)
      return next.map((col, i) => {
        if (col.field === '' || (counts.get(col.field) ?? 0) < 2 || col.constants != null) return col
        const guess = guessColumnConstants(headerHints[i] ?? '')
        return { ...col, constants: Object.fromEntries(Object.entries(guess).filter(([, v]) => v != null)) as Record<string, string> }
      })
    })
  }

  function setColumnConstant(index: number, key: string, value: string) {
    setColumns((prev) => prev.map((col, i) => (i === index ? { ...col, constants: { ...(col.constants ?? {}), [key]: value } } : col)))
  }

  function updateHeaderRule(index: number, patch: Partial<BlockHeaderRule>) {
    setHeaderRules((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)))
  }

  function setHeaderRuleCondition(index: number, value: string) {
    setCustomHeaderRules((prev) => {
      const next = new Set(prev)
      if (value === 'custom') next.add(index)
      else next.delete(index)
      return next
    })
    if (value !== 'custom') updateHeaderRule(index, { pattern: value })
    else if (headerRules[index]?.pattern === '') updateHeaderRule(index, { pattern: '.+' })
  }

  function removeHeaderRule(index: number) {
    setHeaderRules((prev) => prev.filter((_, j) => j !== index))
    // Номера правил ниже удалённого сдвигаются — режим «своё выражение» сдвигается вместе с ними.
    setCustomHeaderRules((prev) => new Set([...prev].filter((j) => j !== index).map((j) => (j > index ? j - 1 : j))))
  }

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
    const saved: SavedMapping = {
      dataStartRow,
      dataEndRow: dataEndRow === '' ? null : dataEndRow,
      columns,
      servicePattern,
      headerRules,
      discrepancy: discrepancyKeyCol !== '' && discrepancyValueCol !== '' ? { keyColumn: discrepancyKeyCol, valueColumn: discrepancyValueCol } : undefined,
    }
    const mappingJson = JSON.stringify(saved)
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
                setHeaderRules([])
                setCustomHeaderRules(new Set())
                setProfileId('')
                setPresetKey('')
              }}
            >
              {Object.entries(TARGET_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </div>
          {(profiles.length > 0 || presets.length > 0) && (
            <div className="form-field">
              <label htmlFor="import-profile">Профиль сопоставления (§3.8d)</label>
              <div className="btn-group">
                <Select
                  id="import-profile"
                  value={profileId !== '' ? String(profileId) : presetKey !== '' ? `preset:${presetKey}` : ''}
                  onChange={(v) => {
                    if (v.startsWith('preset:')) {
                      const preset = presets.find((p) => `preset:${p.key}` === v)
                      setProfileId('')
                      setPresetKey(preset?.key ?? '')
                      if (preset) applyMapping(preset.mapping)
                      return
                    }
                    const id = v === '' ? '' : Number(v)
                    setPresetKey('')
                    setProfileId(id)
                    if (id !== '') applyProfile(id)
                  }}
                >
                  <option value="">Без профиля — настроить заново</option>
                  {presets.map((p) => (
                    <option key={p.key} value={`preset:${p.key}`}>
                      Готовый: {p.name}
                    </option>
                  ))}
                  {profiles.map((p) => (
                    <option key={p.id} value={String(p.id)}>
                      {p.name}
                    </option>
                  ))}
                </Select>
                {/* Готовый профиль поставляется с программой — удалять нечего. */}
                {!selectedPreset && (
                  <button
                    type="button"
                    className="btn btn-danger"
                    disabled={selectedProfile == null}
                    onClick={() => selectedProfile && setPendingProfileDelete(selectedProfile)}
                  >
                    {ruCommon.delete}
                  </button>
                )}
              </div>
              {selectedPreset && <span className="history-empty">{selectedPreset.description}</span>}
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
              <thead>
                <tr>
                  <th />
                  {Array.from({ length: columnCount }, (_, c) => (
                    <th key={c}>{columnLetter(c)}</th>
                  ))}
                </tr>
              </thead>
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
                      {columnLetter(c)}
                      {headerHints[c] ? <div className="history-empty">{headerHints[c]}</div> : null}
                    </th>
                  ))}
                </tr>
                <tr>
                  <th>Поле</th>
                  {Array.from({ length: columnCount }, (_, c) => (
                    <th key={c}>
                      <Select aria-label={`Поле колонки ${columnLetter(c)}`} value={columns[c]?.field ?? ''} onChange={(v) => setColumnField(c, v)}>
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
                {valueFields.size > 0 &&
                  constantFields.map((f) => (
                    <tr key={f.field}>
                      <th>{f.labelRu}</th>
                      {Array.from({ length: columnCount }, (_, c) => {
                        const col = columns[c]
                        return (
                          <th key={c}>
                            {col && valueFields.has(col.field) ? (
                              <input
                                type="text"
                                aria-label={`${f.labelRu} для колонки ${columnLetter(c)}`}
                                value={col.constants?.[f.field] ?? ''}
                                onChange={(e) => setColumnConstant(c, f.field, e.target.value)}
                              />
                            ) : null}
                          </th>
                        )
                      })}
                    </tr>
                  ))}
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

          {valueFields.size > 0 && (
            <p className="history-empty">
              Поле «{fields.filter((f) => valueFields.has(f.field)).map((f) => f.labelRu).join('», «')}» сопоставлено нескольким колонкам: каждая из них
              даёт из строки отдельную запись, а её признаки (строки таблицы выше) подставлены из шапки — проверьте их. Пустая ячейка или ноль — записи нет.
            </p>
          )}

          <h4>Строки-заголовки блоков (§3.8a)</h4>
          <p className="history-empty">
            Если преподаватель или дисциплина записаны отдельной строкой над блоком групп, опишите, как узнать такую строку. Она не станет записью,
            а её значение получат все строки блока ниже. Порядок правил — уровни: правило выше сбрасывает значения правил ниже.
          </p>
          {headerRules.map((rule, i) => {
            const custom = customHeaderRules.has(i) || !HEADER_CONDITIONS.some((h) => h.pattern === rule.pattern)
            return (
              <div key={i} className="subpanel-row">
                <span>Если в колонке</span>
                <Select aria-label="Колонка-признак" value={rule.columnIndex} onChange={(v) => updateHeaderRule(i, { columnIndex: Number(v) })}>
                  {Array.from({ length: columnCount }, (_, c) => (
                    <option key={c} value={c}>
                      {columnLabel(c)}
                    </option>
                  ))}
                </Select>
                <Select aria-label="Условие" value={custom ? 'custom' : rule.pattern} onChange={(v) => setHeaderRuleCondition(i, v)}>
                  {HEADER_CONDITIONS.map((h) => (
                    <option key={h.label} value={h.pattern}>
                      {h.label}
                    </option>
                  ))}
                  <option value="custom">совпадает с выражением…</option>
                </Select>
                {custom && (
                  <input
                    type="text"
                    aria-label="Регулярное выражение"
                    value={rule.pattern}
                    onChange={(e) => updateHeaderRule(i, { pattern: e.target.value })}
                    aria-invalid={headerRuleErrors[i] != null}
                  />
                )}
                <span>, то</span>
                <Select aria-label="Поле из заголовка" value={rule.field} onChange={(v) => updateHeaderRule(i, { field: v })}>
                  <option value="">поле…</option>
                  {fields.map((f) => (
                    <option key={f.field} value={f.field}>
                      {f.labelRu}
                    </option>
                  ))}
                </Select>
                <span>берётся из колонки</span>
                <Select aria-label="Колонка значения" value={rule.sourceColumnIndex} onChange={(v) => updateHeaderRule(i, { sourceColumnIndex: Number(v) })}>
                  {Array.from({ length: columnCount }, (_, c) => (
                    <option key={c} value={c}>
                      {columnLabel(c)}
                    </option>
                  ))}
                </Select>
                <button type="button" className="btn btn-danger" onClick={() => removeHeaderRule(i)}>
                  {ruCommon.delete}
                </button>
                {headerRuleErrors[i] && <span className="form-error">Правило не применено: {headerRuleErrors[i]}</span>}
              </div>
            )
          })}
          <button
            type="button"
            className="btn"
            onClick={() => setHeaderRules((prev) => [...prev, { columnIndex: 0, pattern: HEADER_CONDITIONS[0].pattern, field: '', sourceColumnIndex: 0 }])}
          >
            + Строка-заголовок
          </button>
          {blocks.headerRows.length > 0 && <p className="history-empty">Строк-заголовков найдено: {blocks.headerRows.length}</p>}

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

          {/* Без строк «Итого» сверять не с чем: каждая колонка показывалась «расхождением с 0»,
              хотя в годовой нагрузке итоги стоят в строках-заголовках, а не в строках «Итого». */}
          {reconciliation.length > 0 && controlRows.length > 0 && (
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
              {halfYearCovered && (
                <span className="history-empty">
                  У записей указано полугодие — каждая уйдёт в семестр своего полугодия того же учебного года, что и выбранный.
                </span>
              )}
            </div>
          )}
          <div className="form-field">
            <label>Действует с</label>
            <input type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} />
          </div>

          <p>
            <strong>Будет создано записей: {mappedRows.length}</strong>
          </p>
          {mappedRows.length > 0 && (
            <div className="data-table-wrap" style={{ maxHeight: 320, overflow: 'auto' }}>
              <table className="data-table">
                <thead>
                  <tr>
                    {fields
                      .filter((f) => covered.has(f.field))
                      .map((f) => (
                        <th key={f.field}>{f.labelRu}</th>
                      ))}
                  </tr>
                </thead>
                <tbody>
                  {mappedRows.slice(0, 30).map((r, i) => (
                    <tr key={i}>
                      {fields
                        .filter((f) => covered.has(f.field))
                        .map((f) => (
                          <td key={f.field}>{cellText(r[f.field] ?? null)}</td>
                        ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {mappedRows.length > 30 && <p className="history-empty">Показаны первые 30 записей из {mappedRows.length}.</p>}

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
