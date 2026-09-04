import { DndContext, PointerSensor, useSensor, useSensors, type DragEndEvent, type DragOverEvent } from '@dnd-kit/core'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { Room, ScheduleTemplate, StudyGroup, Teacher, TemplateEntryView, UnassignedLoadRow } from '../../../../shared/ipc/contract'
import { describeConflicts } from '../../../../shared/schedule/messages'
import { findConflicts, type SlotEntry } from '../../../../solver/validate'
import { api } from '../../api/client'
import { ConfirmDialog } from '../../ui/ConfirmDialog'
import { notifyError, notifySuccess } from '../../ui/toast'
import { WEEKDAY_LABEL } from '../../ui/locale'
import { useSemesterOptions } from '../load/useSemesterOptions'
import { EntryDialog } from './EntryDialog'
import { NewVersionDialog } from './NewVersionDialog'
import { RolloutDialog } from './RolloutDialog'
import { ScheduleGrid } from './ScheduleGrid'
import { UnassignedLoadPanel } from './UnassignedLoadPanel'
import { cellId, parseCellId, type DragPayload } from './types'
import { FilterSelect } from '../../ui/FilterSelect'
import { useInitialSelection } from '../../ui/useInitialSelection'

type CutKind = 'group' | 'teacher' | 'room'
type ViewMode = 'week' | 'day'

const WEEK_DAYS = [1, 2, 3, 4, 5, 6]

/** Подпись второго фильтра зависит от разреза: «Все преподаватели» в поле «Группа» сбивало. */
const CUT_TARGET_LABEL: Record<CutKind, string> = { group: 'Группа', teacher: 'Преподаватель', room: 'Кабинет' }

// Стабильные ссылки: пустая сетка не должна пересоздавать зависимые useMemo на каждый рендер.
const EMPTY_ENTRIES: TemplateEntryView[] = []
const EMPTY_UNASSIGNED: UnassignedLoadRow[] = []

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
  useInitialSelection(semesters, semesterId !== '', (list) => setSemesterId(list[0]!.id))
  const selectedSemesterId = semesterId
  const selectedSemester = semesters.find((s) => s.id === selectedSemesterId)

  const [templates, setTemplates] = useState<ScheduleTemplate[]>([])
  const [templateId, setTemplateId] = useState<number | ''>(link.templateId)
  // Данные хранятся вместе с версией шаблона, к которой относятся: пока ответ по новой версии
  // не пришёл, сетка пустая, а не заполнена занятиями предыдущей — перетаскивание в этот
  // момент правило бы не тот шаблон, что видно на экране.
  const [loaded, setLoaded] = useState<{ templateId: number | ''; entries: TemplateEntryView[]; unassigned: UnassignedLoadRow[] }>({
    templateId: '',
    entries: [],
    unassigned: [],
  })
  const entries = loaded.templateId === templateId ? loaded.entries : EMPTY_ENTRIES
  const unassigned = loaded.templateId === templateId ? loaded.unassigned : EMPTY_UNASSIGNED

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
  const [confirmDeleteTemplate, setConfirmDeleteTemplate] = useState(false)
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

  // Запросы за версиями шаблона идут параллельно и возвращаются в произвольном порядке.
  // Без сверки с текущей версией ответ по прежней перезаписывал сетку, и перетаскивание
  // в этот момент правило не тот шаблон, что видно на экране.
  const shownTemplateRef = useRef<number | ''>('')

  const refreshTemplateData = useCallback((id: number) => {
    void api.invoke('scheduleTemplates:entries', { templateId: id }).then((res) => {
      if (shownTemplateRef.current !== id) return
      if (res.ok) setLoaded((prev) => ({ templateId: id, entries: res.value, unassigned: prev.templateId === id ? prev.unassigned : [] }))
      else notifyError(res.error.message)
    })
    void api.invoke('scheduleTemplates:unassignedLoad', { templateId: id }).then((res) => {
      if (shownTemplateRef.current !== id) return
      if (res.ok) setLoaded((prev) => ({ templateId: id, entries: prev.templateId === id ? prev.entries : [], unassigned: res.value }))
      else notifyError(res.error.message)
    })
  }, [])

  useEffect(() => {
    shownTemplateRef.current = templateId
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

  async function archiveCurrentTemplate() {
    if (!currentTemplate) return
    const res = await api.invoke('scheduleTemplates:archive', { id: currentTemplate.id, rowVersion: currentTemplate.rowVersion })
    if (!res.ok) return notifyError(res.error.message)
    notifySuccess('Версия отправлена в архив')
    void api.invoke('scheduleTemplates:list', { semesterId: selectedSemesterId as number }).then((r) => r.ok && setTemplates(r.value))
  }

  /** Удаление версии целиком (§4.1): вместе со всей её сеткой, одной отменяемой операцией. */
  async function deleteCurrentTemplate() {
    if (!currentTemplate) return
    const res = await api.invoke('scheduleTemplates:delete', { id: currentTemplate.id, rowVersion: currentTemplate.rowVersion })
    setConfirmDeleteTemplate(false)
    if (!res.ok) return notifyError(res.error.message)
    notifySuccess('Версия шаблона удалена')
    setTemplateId('')
    void api.invoke('scheduleTemplates:list', { semesterId: selectedSemesterId as number }).then((r) => r.ok && setTemplates(r.value))
  }

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
          <FilterSelect
            label="Семестр"
            hint="Семестр, чьи версии шаблона показывать"
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
          <FilterSelect
            label="Версия"
            hint="Версия шаблона недели: черновик правится свободно, активная — действующая с указанной даты"
            value={templateId}
            onChange={(v) => setTemplateId(v === '' ? '' : Number(v))}
          >
            <option value="">Версия шаблона…</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                v{t.versionNo} с {t.effectiveFrom} ({t.status})
              </option>
            ))}
          </FilterSelect>
          <button type="button" className="btn" disabled={selectedSemesterId === ''} onClick={() => setShowNewVersion(true)}>
            + Новая версия
          </button>
          {currentTemplate?.status === 'draft' && (
            <button type="button" className="btn" title="Сделать эту версию действующей с её даты вступления в силу" onClick={() => void activateTemplate()}>
              Активировать
            </button>
          )}
          {currentTemplate != null && currentTemplate.status !== 'archived' && (
            <button type="button" className="btn" title="Убрать версию из рабочего списка, сохранив её содержимое" onClick={() => void archiveCurrentTemplate()}>
              Архивировать
            </button>
          )}
          {currentTemplate != null && (
            <button
              type="button"
              className="btn btn-danger"
              title="Удалить версию вместе со всей её сеткой занятий"
              onClick={() => setConfirmDeleteTemplate(true)}
            >
              Удалить версию
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
            <FilterSelect
              label="Разрез"
              hint="Чьё расписание показывать в сетке: группы, преподавателя или кабинета"
              value={cutKind}
              onChange={(v) => {
                setCutKind(v as CutKind)
                setCutTargetId('')
              }}
            >
              <option value="group">По группе</option>
              <option value="teacher">По преподавателю</option>
              <option value="room">По кабинету</option>
            </FilterSelect>
            <FilterSelect
              label={CUT_TARGET_LABEL[cutKind]}
              hint="«Все» — показать сетку целиком, без отбора"
              value={cutTargetId}
              onChange={(v) => setCutTargetId(v === '' ? '' : Number(v))}
            >
              <option value="">Все</option>
              {cutOptions.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </FilterSelect>
            <FilterSelect
              label="Вид"
              hint="Показать всю неделю сразу или один день крупнее"
              value={viewMode}
              onChange={(v) => setViewMode(v as ViewMode)}
            >
              <option value="week">Неделя</option>
              <option value="day">День</option>
            </FilterSelect>
            {viewMode === 'day' && (
              <FilterSelect label="День" hint="День недели, показанный в сетке" value={viewDay} onChange={(v) => setViewDay(Number(v))}>
                {WEEK_DAYS.map((d) => (
                  <option key={d} value={d}>
                    {WEEKDAY_LABEL[d]}
                  </option>
                ))}
              </FilterSelect>
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

      {confirmDeleteTemplate && currentTemplate && (
        <ConfirmDialog
          open
          danger
          title={`Удалить версию v${currentTemplate.versionNo}?`}
          description={
            'Занятия этой версии в шаблоне будут удалены. Если с версии уже раскатано расписание, удаление не пройдёт — ' +
            'сначала отмените раскатку на экране «Операции». Само удаление тоже можно отменить там же.'
          }
          confirmLabel="Да, удалить"
          onConfirm={() => void deleteCurrentTemplate()}
          onCancel={() => setConfirmDeleteTemplate(false)}
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
