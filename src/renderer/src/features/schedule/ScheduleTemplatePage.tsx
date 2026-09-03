import { DndContext, PointerSensor, useSensor, useSensors, type DragEndEvent, type DragOverEvent } from '@dnd-kit/core'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { Room, ScheduleTemplate, StudyGroup, Teacher, TemplateEntryView, UnassignedLoadRow } from '../../../../shared/ipc/contract'
import { describeConflicts } from '../../../../shared/schedule/messages'
import { findConflicts, type SlotEntry } from '../../../../solver/validate'
import { api } from '../../api/client'
import { notifyError, notifySuccess } from '../../ui/toast'
import { WEEKDAY_LABEL } from '../../ui/locale'
import { useSemesterOptions } from '../load/useSemesterOptions'
import { EntryDialog } from './EntryDialog'
import { NewVersionDialog } from './NewVersionDialog'
import { RolloutDialog } from './RolloutDialog'
import { ScheduleGrid } from './ScheduleGrid'
import { UnassignedLoadPanel } from './UnassignedLoadPanel'
import { cellId, parseCellId, type DragPayload } from './types'

type CutKind = 'group' | 'teacher' | 'room'
type ViewMode = 'week' | 'day'

const WEEK_DAYS = [1, 2, 3, 4, 5, 6]

function numberParam(raw: string | null): number | '' {
  const n = Number(raw)
  return raw != null && Number.isFinite(n) ? n : ''
}

/** Шаблон недели: сетка 6×6, панель нераспределённой нагрузки, конфликты, версии, раскатка (§4). */
export function ScheduleTemplatePage() {
  // Переход с экрана конфликтов (задача 4.11): ссылка задаёт стартовое состояние экрана —
  // семестр, версию шаблона, разрез по группе и день, — а дальше завуч меняет его сам.
  const [searchParams, setSearchParams] = useSearchParams()
  const [link] = useState(() => ({
    semesterId: numberParam(searchParams.get('semester')),
    templateId: numberParam(searchParams.get('template')),
    groupId: numberParam(searchParams.get('group')),
    dayOfWeek: numberParam(searchParams.get('day')),
  }))

  useEffect(() => {
    if (link.templateId !== '') setSearchParams({}, { replace: true })
  }, [link, setSearchParams])

  const { semesters, label: semesterLabel } = useSemesterOptions()
  const [semesterId, setSemesterId] = useState<number | ''>(link.semesterId)
  const selectedSemesterId = semesterId !== '' ? semesterId : (semesters[0]?.id ?? '')
  const selectedSemester = semesters.find((s) => s.id === selectedSemesterId)

  const [templates, setTemplates] = useState<ScheduleTemplate[]>([])
  const [templateId, setTemplateId] = useState<number | ''>(link.templateId)
  const [entries, setEntries] = useState<TemplateEntryView[]>([])
  const [unassigned, setUnassigned] = useState<UnassignedLoadRow[]>([])

  const [groups, setGroups] = useState<StudyGroup[]>([])
  const [teachers, setTeachers] = useState<Teacher[]>([])
  const [rooms, setRooms] = useState<Room[]>([])
  const [pairNumbers, setPairNumbers] = useState<number[]>([1, 2, 3, 4, 5, 6])
  const [pairTimes, setPairTimes] = useState<Map<number, string>>(new Map())

  const [cutKind, setCutKind] = useState<CutKind>('group')
  const [cutTargetId, setCutTargetId] = useState<number | ''>(link.groupId)
  const [viewMode, setViewMode] = useState<ViewMode>(link.dayOfWeek === '' ? 'week' : 'day')
  const [viewDay, setViewDay] = useState(link.dayOfWeek === '' ? 1 : link.dayOfWeek)

  const [editingEntry, setEditingEntry] = useState<TemplateEntryView | null>(null)
  const [showNewVersion, setShowNewVersion] = useState(false)
  const [showRollout, setShowRollout] = useState(false)
  const [hoverConflict, setHoverConflict] = useState<{ cellKey: string; message: string } | null>(null)

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))

  useEffect(() => {
    void api.invoke('groups:list', {}).then((res) => res.ok && setGroups(res.value))
    void api.invoke('teachers:list', {}).then((res) => res.ok && setTeachers(res.value))
    void api.invoke('rooms:list', {}).then((res) => res.ok && setRooms(res.value))
    void api.invoke('pairGrid:list', {}).then((res) => {
      if (!res.ok) return
      const enabled = res.value.filter((p) => p.enabled).sort((a, b) => a.pairNo - b.pairNo)
      if (enabled.length > 0) setPairNumbers(enabled.map((p) => p.pairNo))
      setPairTimes(new Map(res.value.map((p) => [p.pairNo, `${p.startsAt}–${p.endsAt}`])))
    })
  }, [])

  useEffect(() => {
    if (selectedSemesterId === '') return
    void api.invoke('scheduleTemplates:list', { semesterId: selectedSemesterId }).then((res) => {
      if (!res.ok) return
      setTemplates(res.value)
      setTemplateId((current) => (current !== '' && res.value.some((t) => t.id === current) ? current : (res.value.at(-1)?.id ?? '')))
    })
  }, [selectedSemesterId])

  const refreshTemplateData = useCallback((id: number) => {
    void api.invoke('scheduleTemplates:entries', { templateId: id }).then((res) => {
      if (res.ok) setEntries(res.value)
      else notifyError(res.error.message)
    })
    void api.invoke('scheduleTemplates:unassignedLoad', { templateId: id }).then((res) => {
      if (res.ok) setUnassigned(res.value)
      else notifyError(res.error.message)
    })
  }, [])

  useEffect(() => {
    if (templateId === '') return
    refreshTemplateData(templateId)
  }, [templateId, refreshTemplateData])

  const groupById = useMemo(() => new Map(groups.map((g) => [g.id, g])), [groups])
  const teacherById = useMemo(() => new Map(teachers.map((t) => [t.id, t])), [teachers])
  const roomById = useMemo(() => new Map(rooms.map((r) => [r.id, r])), [rooms])

  const nameResolver = useMemo(
    () => ({
      teacherName: (id: number) => {
        const t = teacherById.get(id)
        return t ? `${t.lastName} ${t.firstName[0]}.` : `#${id}`
      },
      groupName: (id: number) => groupById.get(id)?.name ?? `#${id}`,
      roomLabel: (id: number) => roomById.get(id)?.number ?? `#${id}`,
      entryLabel: (id: number) => {
        const e = entries.find((x) => x.id === id)
        if (!e) return `занятие #${id}`
        const who = e.attendees.map((a) => (a.subgroupNo != null ? `${a.groupName} п/гр ${a.subgroupNo}` : a.groupName)).join(', ')
        return who ? `${who} («${e.disciplineName}»)` : `«${e.disciplineName}»`
      },
    }),
    [teacherById, groupById, roomById, entries],
  )

  const cutOptions = cutKind === 'group' ? groups.map((g) => ({ id: g.id, label: g.name })) : cutKind === 'teacher' ? teachers.map((t) => ({ id: t.id, label: `${t.lastName} ${t.firstName}` })) : rooms.map((r) => ({ id: r.id, label: r.number }))

  // Смена разреза и режима — только фильтрация уже загруженных записей: данные пришли
  // одним запросом, перезагрузки страницы нет (задача 4.6).
  const filteredEntries = useMemo(() => {
    if (cutTargetId === '') return entries
    return entries.filter((e) => {
      if (cutKind === 'group') return e.attendees.some((a) => a.groupId === cutTargetId)
      if (cutKind === 'teacher') return e.teacherId === cutTargetId
      return e.roomId === cutTargetId
    })
  }, [entries, cutKind, cutTargetId])

  const visibleDays = viewMode === 'day' ? [viewDay] : WEEK_DAYS

  const allSlotEntries: SlotEntry[] = useMemo(
    () =>
      entries.map((e) => ({
        id: e.id,
        dayOfWeek: e.dayOfWeek,
        pairNo: e.pairNo,
        weekParity: e.weekParity,
        teacherId: e.teacherId,
        roomId: e.roomId,
        attendees: e.attendees.map((a) => ({ groupId: a.groupId, posFrom: a.posFrom, posTo: a.posTo })),
      })),
    [entries],
  )

  function candidateFromPayload(payload: DragPayload, dayOfWeek: number, pairNo: number): SlotEntry {
    return {
      id: payload.kind === 'entry' ? payload.entryId : -1,
      dayOfWeek,
      pairNo,
      weekParity: payload.kind === 'entry' ? payload.weekParity : 'all',
      teacherId: payload.teacherId,
      roomId: payload.kind === 'entry' ? payload.roomId : null,
      attendees: payload.attendees.map((a) => ({ groupId: a.groupId, posFrom: a.posFrom, posTo: a.posTo })),
    }
  }

  function handleDragOver(event: DragOverEvent) {
    const overId = event.over?.id
    const cell = typeof overId === 'string' ? parseCellId(overId) : null
    const payload = event.active.data.current as DragPayload | undefined
    if (!cell || !payload) {
      setHoverConflict(null)
      return
    }
    const candidate = candidateFromPayload(payload, cell.dayOfWeek, cell.pairNo)
    const conflicts = findConflicts(candidate, allSlotEntries)
    setHoverConflict(conflicts.length > 0 ? { cellKey: cellId(cell.dayOfWeek, cell.pairNo), message: describeConflicts(conflicts, nameResolver) } : null)
  }

  function handleDragEnd(event: DragEndEvent) {
    setHoverConflict(null)
    if (templateId === '') return
    const overId = event.over?.id
    const cell = typeof overId === 'string' ? parseCellId(overId) : null
    const payload = event.active.data.current as DragPayload | undefined
    if (!cell || !payload) return

    if (payload.kind === 'load') {
      void api
        .invoke('scheduleTemplates:placeEntry', {
          templateId,
          teachingLoadId: payload.teachingLoadId,
          dayOfWeek: cell.dayOfWeek,
          pairNo: cell.pairNo,
          weekParity: 'all',
          roomId: null,
        })
        .then((res) => {
          if (res.ok) {
            notifySuccess('Занятие поставлено')
            refreshTemplateData(templateId as number)
          } else {
            notifyError(res.error.message)
          }
        })
    } else {
      void api
        .invoke('scheduleTemplates:moveEntry', {
          id: payload.entryId,
          rowVersion: payload.rowVersion,
          dayOfWeek: cell.dayOfWeek,
          pairNo: cell.pairNo,
          weekParity: payload.weekParity,
          roomId: payload.roomId,
        })
        .then((res) => {
          if (res.ok) {
            notifySuccess('Занятие перенесено')
            refreshTemplateData(templateId as number)
          } else {
            notifyError(res.error.message)
          }
        })
    }
  }

  async function toggleLock(entry: TemplateEntryView) {
    const res = await api.invoke('scheduleTemplates:setLocked', { id: entry.id, rowVersion: entry.rowVersion, isLocked: !entry.isLocked })
    if (res.ok) refreshTemplateData(templateId as number)
    else notifyError(res.error.message)
  }

  async function activateTemplate() {
    if (templateId === '') return
    const tmpl = templates.find((t) => t.id === templateId)
    if (!tmpl) return
    const res = await api.invoke('scheduleTemplates:activate', { id: tmpl.id, rowVersion: tmpl.rowVersion })
    if (res.ok) {
      notifySuccess('Версия активирована')
      void api.invoke('scheduleTemplates:list', { semesterId: selectedSemesterId as number }).then((r) => r.ok && setTemplates(r.value))
    } else {
      notifyError(res.error.message)
    }
  }

  const currentTemplate = templates.find((t) => t.id === templateId) ?? null

  async function handleExportExcel(kind: 'group' | 'teacher' | 'summary') {
    if (templateId === '') return
    const targetId = kind === 'summary' ? undefined : cutTargetId === '' ? undefined : cutTargetId
    if (kind !== 'summary' && targetId == null) {
      notifyError(kind === 'group' ? 'Выберите группу в разрезе выше' : 'Выберите преподавателя в разрезе выше')
      return
    }
    const res = await api.invoke('export:excel', { templateId, kind, targetId })
    if (!res.ok) return notifyError(res.error.message)
    if (!('cancelled' in res.value)) notifySuccess(`Сохранено: ${res.value.path}`)
  }

  async function handlePrintPdf() {
    if (templateId === '' || cutKind !== 'group' || cutTargetId === '') {
      notifyError('Выберите группу в разрезе выше, чтобы напечатать её расписание')
      return
    }
    const res = await api.invoke('export:pdf', { templateId, groupId: cutTargetId })
    if (!res.ok) return notifyError(res.error.message)
    if (!('cancelled' in res.value)) notifySuccess(`Сохранено: ${res.value.path}`)
  }

  return (
    <div>
      <div className="page-header">
        <h1>Шаблон недели</h1>
        <div className="toolbar-actions">
          <select value={selectedSemesterId} onChange={(e) => setSemesterId(e.target.value === '' ? '' : Number(e.target.value))}>
            <option value="">Выберите семестр</option>
            {semesters.map((s) => (
              <option key={s.id} value={s.id}>
                {semesterLabel(s.id)}
              </option>
            ))}
          </select>
          <select value={templateId} onChange={(e) => setTemplateId(e.target.value === '' ? '' : Number(e.target.value))}>
            <option value="">Версия шаблона…</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                v{t.versionNo} с {t.effectiveFrom} ({t.status})
              </option>
            ))}
          </select>
          <button type="button" className="btn" disabled={selectedSemesterId === ''} onClick={() => setShowNewVersion(true)}>
            + Новая версия
          </button>
          {currentTemplate?.status === 'draft' && (
            <button type="button" className="btn" onClick={() => void activateTemplate()}>
              Активировать
            </button>
          )}
          <button type="button" className="btn btn-primary" disabled={templateId === ''} onClick={() => setShowRollout(true)}>
            Раскатать
          </button>
        </div>
      </div>

      {templateId === '' ? (
        <p className="history-empty">Выберите семестр и версию шаблона</p>
      ) : (
        <>
          <div className="toolbar-actions" style={{ marginBottom: 12 }}>
            <select
              value={cutKind}
              onChange={(e) => {
                setCutKind(e.target.value as CutKind)
                setCutTargetId('')
              }}
            >
              <option value="group">По группе</option>
              <option value="teacher">По преподавателю</option>
              <option value="room">По кабинету</option>
            </select>
            <select value={cutTargetId} onChange={(e) => setCutTargetId(e.target.value === '' ? '' : Number(e.target.value))}>
              <option value="">Все</option>
              {cutOptions.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
            <select value={viewMode} onChange={(e) => setViewMode(e.target.value as ViewMode)}>
              <option value="week">Неделя</option>
              <option value="day">День</option>
            </select>
            {viewMode === 'day' && (
              <select value={viewDay} onChange={(e) => setViewDay(Number(e.target.value))}>
                {WEEK_DAYS.map((d) => (
                  <option key={d} value={d}>
                    {WEEKDAY_LABEL[d]}
                  </option>
                ))}
              </select>
            )}
            <button type="button" className="btn" onClick={() => void handleExportExcel('group')} disabled={cutKind !== 'group' || cutTargetId === ''}>
              Excel: группа
            </button>
            <button type="button" className="btn" onClick={() => void handleExportExcel('teacher')} disabled={cutKind !== 'teacher' || cutTargetId === ''}>
              Excel: преподаватель
            </button>
            <button type="button" className="btn" onClick={() => void handleExportExcel('summary')}>
              Excel: сводное
            </button>
            <button type="button" className="btn" onClick={() => void handlePrintPdf()} disabled={cutKind !== 'group' || cutTargetId === ''}>
              Печать PDF
            </button>
          </div>

          <DndContext sensors={sensors} onDragOver={handleDragOver} onDragEnd={handleDragEnd}>
            <div className="schedule-layout">
              <ScheduleGrid
                days={visibleDays}
                pairNumbers={pairNumbers}
                pairLabel={(pairNo) => `${pairNo} пара\n${pairTimes.get(pairNo) ?? ''}`}
                entries={filteredEntries}
                hoverConflictCellKey={hoverConflict?.cellKey ?? null}
                hoverConflictMessage={hoverConflict?.message ?? null}
                onEntryClick={setEditingEntry}
                onToggleLock={(e) => void toggleLock(e)}
              />
              <UnassignedLoadPanel rows={unassigned} />
            </div>
          </DndContext>
        </>
      )}

      {editingEntry && (
        <EntryDialog
          entry={editingEntry}
          rooms={rooms}
          onClose={() => setEditingEntry(null)}
          onChanged={() => {
            setEditingEntry(null)
            refreshTemplateData(templateId as number)
          }}
        />
      )}

      {showNewVersion && selectedSemesterId !== '' && (
        <NewVersionDialog
          semesterId={selectedSemesterId}
          currentTemplateId={templateId === '' ? null : templateId}
          onClose={() => setShowNewVersion(false)}
          onCreated={(id) => {
            setShowNewVersion(false)
            void api.invoke('scheduleTemplates:list', { semesterId: selectedSemesterId as number }).then((res) => {
              if (res.ok) {
                setTemplates(res.value)
                setTemplateId(id)
              }
            })
          }}
        />
      )}

      {showRollout && templateId !== '' && (
        <RolloutDialog
          templateId={templateId}
          defaultDateFrom={selectedSemester?.startsOn}
          defaultDateTo={selectedSemester?.endsOn}
          onClose={() => setShowRollout(false)}
          onApplied={() => {
            setShowRollout(false)
            refreshTemplateData(templateId as number)
          }}
        />
      )}
    </div>
  )
}
