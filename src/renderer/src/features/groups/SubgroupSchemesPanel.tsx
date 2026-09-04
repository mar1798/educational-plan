import { useCallback, useEffect, useMemo, useState } from 'react'
import type { AcademicYear, DivisionSchemeWithSubgroups, Semester, StudyGroup } from '../../../../shared/ipc/contract'
import { api } from '../../api/client'
import { ConfirmDialog } from '../../ui/ConfirmDialog'
import { EntityHistoryPanel } from '../../ui/EntityHistoryPanel'
import { ruCommon } from '../../ui/locale'
import { notifyError, notifySuccess } from '../../ui/toast'
import { Select } from '../../ui/Select'

interface SubgroupSchemesPanelProps {
  group: StudyGroup
}

interface BoundDraft {
  subgroupId: number
  rowVersion: number
  posFrom: string
  posTo: string
}

// Подписи на сегментах белые, поэтому оттенки затемнены до контраста не ниже 4.5:1:
// прежние (#2ba86c, #d97706) давали на светлых мониторах Windows нечитаемую надпись.
const SEGMENT_COLORS = ['#3949c9', '#1b7a4b', '#a45a06', '#b02f22', '#7a349a', '#0e7490']

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

function draftsFromScheme(scheme: DivisionSchemeWithSubgroups): BoundDraft[] {
  return scheme.subgroups.map((s) => ({
    subgroupId: s.id,
    rowVersion: s.rowVersion,
    posFrom: String(s.posFrom),
    posTo: String(s.posTo),
  }))
}

/**
 * Схемы деления на подгруппы (§2.5) и наглядная проверка их совместимости (§2.6):
 * границы рассчитываются автоматически при создании схемы («на 2»/«на 3»), дальше
 * их можно только вручную поправить — не добавляя и не убирая подгруппы. Ниже —
 * полоса позиций 1..N по всем активным схемам и список пересечений подгрупп разных схем.
 */
export function SubgroupSchemesPanel({ group }: SubgroupSchemesPanelProps) {
  const [schemes, setSchemes] = useState<DivisionSchemeWithSubgroups[] | null>(null)
  const [drafts, setDrafts] = useState<Record<number, BoundDraft[]>>({})
  const [academicYears, setAcademicYears] = useState<AcademicYear[]>([])
  const [semesters, setSemesters] = useState<Semester[]>([])
  const [pendingDelete, setPendingDelete] = useState<DivisionSchemeWithSubgroups | null>(null)
  const [expandedHistory, setExpandedHistory] = useState<Record<number, boolean>>({})

  const [semesterId, setSemesterId] = useState<number | ''>('')
  const [name, setName] = useState('')
  const [partsCount, setPartsCount] = useState<2 | 3>(2)
  const [isDefault, setIsDefault] = useState(false)

  const refresh = useCallback(
    () =>
      api.invoke('divisionSchemes:listForGroup', { groupId: group.id }).then((res) => {
        if (res.ok) {
          setSchemes(res.value)
          setDrafts(Object.fromEntries(res.value.map((s) => [s.id, draftsFromScheme(s)])))
        } else {
          notifyError(res.error.message)
        }
      }),
    [group.id],
  )

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    void api.invoke('academicYears:list', {}).then((res) => {
      if (res.ok) setAcademicYears(res.value)
    })
    void api.invoke('semesters:list', {}).then((res) => {
      if (res.ok) setSemesters(res.value)
    })
  }, [])

  const yearNameById = useMemo(() => new Map(academicYears.map((y) => [y.id, y.name])), [academicYears])
  const semesterLabel = useCallback(
    (id: number) => {
      const sem = semesters.find((s) => s.id === id)
      if (!sem) return `#${id}`
      return `${yearNameById.get(sem.academicYearId) ?? sem.academicYearId}, ${sem.no}-й семестр`
    },
    [semesters, yearNameById],
  )

  async function createScheme() {
    if (semesterId === '' || name.trim() === '') return
    const res = await api.invoke('divisionSchemes:create', { groupId: group.id, semesterId, name: name.trim(), partsCount, isDefault })
    if (res.ok) {
      notifySuccess('Схема деления создана')
      setSemesterId('')
      setName('')
      setIsDefault(false)
      await refresh()
    } else {
      notifyError(res.error.message)
    }
  }

  async function saveBounds(scheme: DivisionSchemeWithSubgroups) {
    const bounds = (drafts[scheme.id] ?? []).map((d) => ({
      subgroupId: d.subgroupId,
      rowVersion: d.rowVersion,
      posFrom: Number(d.posFrom),
      posTo: Number(d.posTo),
    }))
    if (bounds.some((b) => !Number.isFinite(b.posFrom) || !Number.isFinite(b.posTo))) {
      notifyError('Границы подгрупп должны быть числами')
      return
    }
    const res = await api.invoke('divisionSchemes:updateBounds', { schemeId: scheme.id, bounds })
    if (res.ok) {
      notifySuccess('Границы подгрупп сохранены')
      await refresh()
    } else {
      notifyError(res.error.message)
    }
  }

  async function toggleClose(scheme: DivisionSchemeWithSubgroups) {
    const res = await api.invoke('divisionSchemes:close', {
      id: scheme.id,
      rowVersion: scheme.rowVersion,
      validTo: scheme.validTo ? null : todayIso(),
    })
    if (res.ok) {
      notifySuccess(scheme.validTo ? 'Открыта заново' : ruCommon.closedOk)
      await refresh()
    } else {
      notifyError(res.error.message)
    }
  }

  async function setDefault(scheme: DivisionSchemeWithSubgroups) {
    const res = await api.invoke('divisionSchemes:setDefault', { id: scheme.id })
    if (res.ok) {
      notifySuccess('Основная схема изменена')
      await refresh()
    } else {
      notifyError(res.error.message)
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return
    const res = await api.invoke('divisionSchemes:delete', { id: pendingDelete.id })
    setPendingDelete(null)
    if (res.ok) {
      notifySuccess(ruCommon.deletedOk)
      await refresh()
    } else {
      notifyError(res.error.message)
    }
  }

  function updateDraft(scheme: DivisionSchemeWithSubgroups, subgroupId: number, field: 'posFrom' | 'posTo', value: string) {
    setDrafts((prev) => ({
      ...prev,
      [scheme.id]: (prev[scheme.id] ?? []).map((d) => (d.subgroupId === subgroupId ? { ...d, [field]: value } : d)),
    }))
  }

  const activeSchemes = (schemes ?? []).filter((s) => s.validTo == null)

  // Пересечения ищем только между схемами одного семестра: схема привязана к семестру (§2.5),
  // подгруппы разных семестров никогда не встречаются в одном расписании.
  const overlaps = useMemo(() => {
    const rows: { key: string; text: string }[] = []
    for (let i = 0; i < activeSchemes.length; i++) {
      for (let j = i + 1; j < activeSchemes.length; j++) {
        const a = activeSchemes[i]!
        const b = activeSchemes[j]!
        if (a.semesterId !== b.semesterId) continue
        for (const sa of a.subgroups) {
          for (const sb of b.subgroups) {
            const from = Math.max(sa.posFrom, sb.posFrom)
            const to = Math.min(sa.posTo, sb.posTo)
            const count = to - from + 1
            if (count > 0) {
              rows.push({
                key: `${sa.id}-${sb.id}`,
                text: `«${a.name} п/гр ${sa.no}» ∩ «${b.name} п/гр ${sb.no}» = ${count} студентов — вместе ставить нельзя`,
              })
            }
          }
        }
      }
    }
    return rows
  }, [activeSchemes])

  return (
    <div className="subpanel">
      <h3>Схемы деления на подгруппы</h3>
      {schemes === null && <p className="history-empty">{ruCommon.loading}</p>}
      {schemes?.length === 0 && <p className="history-empty">Схем деления пока нет — вся группа занимается вместе</p>}

      {schemes?.map((scheme) => (
        <div className="scheme-card" key={scheme.id}>
          <div className="scheme-card-header">
            <span>
              <strong>{scheme.name}</strong> — {semesterLabel(scheme.semesterId)}, на {scheme.partsCount}
              {scheme.isDefault && <span className="badge">Основная</span>}
              {scheme.validTo && <span className="badge">Закрыта с {scheme.validTo}</span>}
            </span>
            <span className="btn-group">
              {!scheme.isDefault && !scheme.validTo && (
                <button className="btn-link" onClick={() => void setDefault(scheme)}>
                  Сделать основной
                </button>
              )}
              <button className="btn-link" onClick={() => void toggleClose(scheme)}>
                {scheme.validTo ? 'Открыть заново' : ruCommon.close}
              </button>
              <button className="btn-link" onClick={() => setPendingDelete(scheme)}>
                {ruCommon.delete}
              </button>
              <button
                className="btn-link"
                onClick={() => setExpandedHistory((prev) => ({ ...prev, [scheme.id]: !prev[scheme.id] }))}
              >
                {expandedHistory[scheme.id] ? 'Скрыть историю' : 'История'}
              </button>
            </span>
          </div>

          <table className="bounds-table">
            <thead>
              <tr>
                <th>Подгруппа</th>
                <th>С позиции</th>
                <th>По позицию</th>
              </tr>
            </thead>
            <tbody>
              {(drafts[scheme.id] ?? []).map((d, idx) => (
                <tr key={d.subgroupId}>
                  <td>№{idx + 1}</td>
                  <td>
                    <input
                      type="number"
                      min={1}
                      value={d.posFrom}
                      onChange={(e) => updateDraft(scheme, d.subgroupId, 'posFrom', e.target.value)}
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      min={1}
                      value={d.posTo}
                      onChange={(e) => updateDraft(scheme, d.subgroupId, 'posTo', e.target.value)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button type="button" className="btn" onClick={() => void saveBounds(scheme)}>
            Сохранить границы
          </button>

          {expandedHistory[scheme.id] && (
            <>
              <EntityHistoryPanel entity="division_scheme" id={scheme.id} />
              {scheme.subgroups.map((sg, idx) => (
                <div key={sg.id}>
                  <h3>История границ подгруппы №{idx + 1}</h3>
                  <EntityHistoryPanel entity="subgroup" id={sg.id} />
                </div>
              ))}
            </>
          )}
        </div>
      ))}

      <div className="subpanel-add">
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
        <div className="form-field">
          <label>Название схемы</label>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Клинические дисциплины" />
        </div>
        <div className="form-field">
          <label>Разделить на</label>
          <Select value={partsCount} onChange={(v) => setPartsCount(Number(v) as 2 | 3)}>
            <option value={2}>2</option>
            <option value={3}>3</option>
          </Select>
        </div>
        <div className="form-field form-field-checkbox">
          <input id="scheme-default" type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} />
          <label htmlFor="scheme-default">Основная</label>
        </div>
        <button type="button" className="btn" onClick={() => void createScheme()} disabled={semesterId === '' || name.trim() === ''}>
          + Добавить схему
        </button>
      </div>

      {activeSchemes.length > 0 && (
        <div className="position-bar-block">
          <h3>Проверка совместимости подгрупп (§2.6)</h3>
          <div className="position-bar-row">
            <span className="position-bar-label">Вся группа</span>
            <div className="position-bar">
              <div className="position-bar-segment" style={{ flexGrow: group.studentsCount, background: 'var(--color-border)' }}>
                1–{group.studentsCount}
              </div>
            </div>
          </div>
          {activeSchemes.map((scheme) => (
            <div className="position-bar-row" key={scheme.id}>
              <span className="position-bar-label">
                {scheme.name} — {semesterLabel(scheme.semesterId)}
              </span>
              <div className="position-bar">
                {scheme.subgroups.map((sg, idx) => (
                  <div
                    key={sg.id}
                    className="position-bar-segment"
                    style={{ flexGrow: sg.posTo - sg.posFrom + 1, background: SEGMENT_COLORS[idx % SEGMENT_COLORS.length] }}
                  >
                    п/гр {sg.no} ({sg.posFrom}–{sg.posTo})
                  </div>
                ))}
              </div>
            </div>
          ))}

          {overlaps.length === 0 ? (
            <p className="history-empty">Пересечений подгрупп разных схем нет</p>
          ) : (
            <ul className="overlap-list">
              {overlaps.map((o) => (
                <li key={o.key} className="overlap-warning">
                  {o.text}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {pendingDelete && (
        <ConfirmDialog
          open
          title={`Удалить схему «${pendingDelete.name}»?`}
          description={ruCommon.confirmDeleteBody}
          confirmLabel={ruCommon.yesDelete}
          danger
          onConfirm={() => void confirmDelete()}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  )
}
