import { useEffect, useState } from 'react'
import type { CurriculumRow, Discipline, DivisionSchemeWithSubgroups, StudyGroup, StreamWithMembers, Teacher, TeachingLoad } from '../../../../shared/ipc/contract'
import { api } from '../../api/client'
import { Dialog } from '../../ui/Dialog'
import { ROOM_TYPE_LABEL, ruCommon } from '../../ui/locale'
import { notifyError, notifySuccess, notifyWarning } from '../../ui/toast'
import { Select } from '../../ui/Select'

interface TeachingLoadDialogProps {
  semesterId: number
  row: TeachingLoad | null
  groups: StudyGroup[]
  teachers: Teacher[]
  disciplines: Map<number, Discipline>
  curriculumRows: CurriculumRow[]
  onClose: () => void
  onSaved: () => void
  onDeleteRequested: (row: TeachingLoad) => void
}

const KIND_LABEL: Record<TeachingLoad['lessonKind'], string> = {
  theory: 'Теоретическое',
  practice: 'Практическое',
  seminar: 'Семинарское',
  lab: 'Лабораторное',
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

/**
 * Строка нагрузки (§3.5, §3.6, §3.6a): либо группа, либо поток; при выборе группы
 * можно указать схему деления и конкретную подгруппу (§3.6). Проверка квалификации
 * и недельного лимита группы — на стороне main (репозиторий), здесь только показ
 * сообщения об ошибке и предупреждения о годовой норме преподавателя.
 */
export function TeachingLoadDialog({
  semesterId,
  row,
  groups,
  teachers,
  disciplines,
  curriculumRows,
  onClose,
  onSaved,
  onDeleteRequested,
}: TeachingLoadDialogProps) {
  const [streams, setStreams] = useState<StreamWithMembers[]>([])
  const [schemes, setSchemes] = useState<DivisionSchemeWithSubgroups[]>([])
  const [schemesGroupId, setSchemesGroupId] = useState<number | ''>('')

  const [targetType, setTargetType] = useState<'group' | 'stream'>(row?.streamId != null ? 'stream' : 'group')
  const [groupId, setGroupId] = useState<number | ''>(row?.groupId ?? '')
  const [streamId, setStreamId] = useState<number | ''>(row?.streamId ?? '')
  const [subgroupChoice, setSubgroupChoice] = useState<string>(row?.subgroupId != null ? `${row.divisionSchemeId}:${row.subgroupId}` : '')
  const [curriculumRowId, setCurriculumRowId] = useState<number | ''>(row?.curriculumRowId ?? '')
  const [teacherId, setTeacherId] = useState<number | ''>(row?.teacherId ?? '')
  const [lessonKind, setLessonKind] = useState<TeachingLoad['lessonKind']>(row?.lessonKind ?? 'theory')
  const [hoursPlanned, setHoursPlanned] = useState(row?.hoursPlanned ?? 0)
  const [requiresParallel, setRequiresParallel] = useState(row?.requiresParallel ?? false)
  const [clinicalModeOverride, setClinicalModeOverride] = useState<TeachingLoad['clinicalModeOverride']>(row?.clinicalModeOverride ?? null)
  const [roomTypeRequired, setRoomTypeRequired] = useState<TeachingLoad['roomTypeRequired']>(row?.roomTypeRequired ?? null)
  const [note, setNote] = useState(row?.note ?? '')
  const [validFrom, setValidFrom] = useState(row?.validFrom ?? todayIso())
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    void api.invoke('streams:listForSemester', { semesterId }).then((res) => res.ok && setStreams(res.value))
  }, [semesterId])

  useEffect(() => {
    if (targetType !== 'group' || groupId === '') return
    void api.invoke('divisionSchemes:listForGroup', { groupId }).then((res) => {
      if (res.ok) {
        setSchemes(res.value.filter((s) => s.validTo == null))
        setSchemesGroupId(groupId)
      }
    })
  }, [targetType, groupId])

  // Схемы фильтруются по groupId, под который они реально загружены — иначе при смене
  // группы виден кадр со схемами прошлой, пока идёт запрос за новыми.
  const visibleSchemes = targetType === 'group' && groupId !== '' && groupId === schemesGroupId ? schemes : []

  const isValid = curriculumRowId !== '' && teacherId !== '' && hoursPlanned > 0 && (targetType === 'group' ? groupId !== '' : streamId !== '')

  async function submit() {
    setLoading(true)
    const [divisionSchemeId, subgroupId] = subgroupChoice ? subgroupChoice.split(':').map(Number) : [null, null]
    const res = await api.invoke('teachingLoad:save', {
      id: row?.id,
      rowVersion: row?.rowVersion,
      semesterId,
      curriculumRowId: curriculumRowId as number,
      teacherId: teacherId as number,
      groupId: targetType === 'group' ? (groupId as number) : null,
      streamId: targetType === 'stream' ? (streamId as number) : null,
      divisionSchemeId: divisionSchemeId ?? null,
      subgroupId: subgroupId ?? null,
      lessonKind,
      hoursPlanned,
      requiresParallel,
      roomTypeRequired,
      clinicalModeOverride,
      note: note.trim() === '' ? null : note,
      validFrom,
    })
    setLoading(false)
    if (res.ok) {
      notifySuccess(ruCommon.savedOk)
      if (res.value.teacherHoursOverYear != null) {
        notifyWarning(`Преподаватель превышает годовую норму часов: набрано ${res.value.teacherHoursOverYear} ч`)
      }
      onSaved()
    } else {
      notifyError(res.error.message)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()} title={row ? 'Строка нагрузки' : 'Новая строка нагрузки'}>
      <div className="form-field">
        <label htmlFor="load-target-type">Кому</label>
        <Select
          id="load-target-type"
          value={targetType}
          onChange={(v) => {
            setTargetType(v as 'group' | 'stream')
            setSubgroupChoice('')
          }}
        >
          <option value="group">Группа</option>
          <option value="stream">Поток</option>
        </Select>
      </div>

      {targetType === 'group' ? (
        <>
          <div className="form-field">
            <label htmlFor="load-group">Группа</label>
            <Select
              id="load-group"
              value={groupId}
              onChange={(v) => {
                setGroupId(v === '' ? '' : Number(v))
                setSubgroupChoice('')
              }}
            >
              <option value="">—</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="form-field">
            <label htmlFor="load-subgroup">Подгруппа (§3.6)</label>
            <Select id="load-subgroup" value={subgroupChoice} onChange={(v) => setSubgroupChoice(v)}>
              <option value="">Вся группа</option>
              {visibleSchemes.map((s) => (
                <optgroup key={s.id} label={s.name}>
                  {s.subgroups.map((sg) => (
                    <option key={sg.id} value={`${s.id}:${sg.id}`}>
                      п/гр {sg.no} ({sg.posFrom}–{sg.posTo})
                    </option>
                  ))}
                </optgroup>
              ))}
            </Select>
          </div>
        </>
      ) : (
        <div className="form-field">
          <label htmlFor="load-stream">Поток</label>
          <Select id="load-stream" value={streamId} onChange={(v) => setStreamId(v === '' ? '' : Number(v))}>
            <option value="">—</option>
            {streams.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </div>
      )}

      <div className="form-field">
        <label htmlFor="load-row">Дисциплина (строка плана)</label>
        <Select id="load-row" value={curriculumRowId} onChange={(v) => setCurriculumRowId(v === '' ? '' : Number(v))}>
          <option value="">—</option>
          {curriculumRows.map((r) => (
            <option key={r.id} value={r.id}>
              {disciplines.get(r.disciplineId)?.name ?? `#${r.disciplineId}`} — курс {r.course}, сем. {r.semesterNo}
            </option>
          ))}
        </Select>
      </div>

      <div className="form-field">
        <label htmlFor="load-teacher">Преподаватель</label>
        <Select id="load-teacher" value={teacherId} onChange={(v) => setTeacherId(v === '' ? '' : Number(v))}>
          <option value="">—</option>
          {teachers.map((t) => (
            <option key={t.id} value={t.id}>
              {t.lastName} {t.firstName}
            </option>
          ))}
        </Select>
      </div>

      <div className="form-field">
        <label htmlFor="load-kind">Вид занятия</label>
        <Select id="load-kind" value={lessonKind} onChange={(v) => setLessonKind(v as TeachingLoad['lessonKind'])}>
          {Object.entries(KIND_LABEL).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
      </div>

      <div className="form-field">
        <label htmlFor="load-hours">Часы</label>
        <input id="load-hours" type="number" min={1} value={hoursPlanned} onChange={(e) => setHoursPlanned(Number(e.target.value))} />
      </div>

      <div className="form-field form-field-checkbox">
        <input id="load-parallel" type="checkbox" checked={requiresParallel} onChange={(e) => setRequiresParallel(e.target.checked)} />
        <label htmlFor="load-parallel">Остальные подгруппы занимаются параллельно</label>
      </div>

      <div className="form-field">
        <label htmlFor="load-clinical">Режим клинической базы (§3.6a)</label>
        <Select
          id="load-clinical"
          value={clinicalModeOverride ?? ''}
          onChange={(v) => setClinicalModeOverride(v === '' ? null : (v as TeachingLoad['clinicalModeOverride']))}
        >
          <option value="">По умолчанию (как у базы)</option>
          <option value="full_day">Весь день на базе</option>
          <option value="block">Блоком</option>
          <option value="free">Свободно</option>
        </Select>
      </div>

      <div className="form-field">
        <label htmlFor="load-room-type">Требуемый тип кабинета</label>
        <Select
          id="load-room-type"
          value={roomTypeRequired ?? ''}
          onChange={(v) => setRoomTypeRequired(v === '' ? null : (v as TeachingLoad['roomTypeRequired']))}
        >
          <option value="">Не важно</option>
          {Object.entries(ROOM_TYPE_LABEL).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
      </div>

      <div className="form-field">
        <label htmlFor="load-valid-from">Действует с</label>
        <input id="load-valid-from" type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} />
      </div>

      <div className="form-field">
        <label htmlFor="load-note">Заметка</label>
        <input id="load-note" type="text" value={note} onChange={(e) => setNote(e.target.value)} />
      </div>

      <div className="dialog-actions-split">
        <div className="btn-group">
          {row != null && (
            <button type="button" className="btn btn-danger" onClick={() => onDeleteRequested(row)}>
              {ruCommon.delete}
            </button>
          )}
        </div>
        <div className="btn-group">
          <button type="button" className="btn" onClick={onClose}>
            {ruCommon.cancel}
          </button>
          <button type="button" className="btn btn-primary" disabled={!isValid || loading} onClick={() => void submit()}>
            {ruCommon.save}
          </button>
        </div>
      </div>
    </Dialog>
  )
}
