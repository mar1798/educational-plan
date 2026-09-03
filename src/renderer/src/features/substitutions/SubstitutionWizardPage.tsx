import { useEffect, useState } from 'react'
import type { Room, SubstituteCandidate, Teacher, TeacherLessonRow } from '../../../../shared/ipc/contract'
import { api } from '../../api/client'
import { notifyError, notifySuccess } from '../../ui/toast'

const STATUS_LABEL: Record<TeacherLessonRow['status'], string> = {
  planned: 'Запланировано',
  held: 'Проведено',
  cancelled: 'Отменено',
  moved: 'Перенесено',
}

function teacherFullName(t: Teacher): string {
  return [t.lastName, t.firstName, t.middleName].filter(Boolean).join(' ')
}

interface SwapPanelProps {
  lessonId: number
  onDone: () => void
  onCancel: () => void
}

/** Подбор замены (§этап 7): кандидаты уже ранжированы main-процессом — «свободен → недобор часов». */
function SwapPanel({ lessonId, onDone, onCancel }: SwapPanelProps) {
  const [candidates, setCandidates] = useState<SubstituteCandidate[] | null>(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void api.invoke('substitutions:candidates', { lessonId }).then((res) => {
      if (res.ok) setCandidates(res.value)
      else notifyError(res.error.message)
    })
  }, [lessonId])

  async function assign(substituteTeacherId: number) {
    setBusy(true)
    const res = await api.invoke('substitutions:swap', { lessonId, substituteTeacherId, reason: reason || null })
    setBusy(false)
    if (res.ok) {
      notifySuccess('Замена назначена')
      onDone()
    } else {
      notifyError(res.error.message)
    }
  }

  return (
    <div className="subpanel-add">
      <div className="form-field">
        <label>Причина (необязательно)</label>
        <input type="text" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Больничный, отпуск…" />
      </div>

      {candidates === null && <p className="history-empty">Загрузка кандидатов…</p>}
      {candidates?.length === 0 && <p className="history-empty">Нет преподавателей с подходящей квалификацией</p>}
      {candidates?.map((c) => (
        <div className="subpanel-row" key={c.teacherId}>
          <span>
            {c.teacherName} · {c.categoryTitle}
            {' — '}
            <span className={c.isFree ? 'badge' : 'badge badge-warning'}>{c.isFree ? 'свободен' : 'занят в это время'}</span>{' '}
            {c.shortfallHours != null && (
              <span className={c.shortfallHours > 0 ? 'badge badge-warning' : 'badge'}>
                {c.shortfallHours > 0 ? `недобор ${c.shortfallHours} ч` : 'норма набрана'}
              </span>
            )}
          </span>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void assign(c.teacherId)}>
            Назначить
          </button>
        </div>
      ))}

      <div className="dialog-actions">
        <button type="button" className="btn" onClick={onCancel}>
          Отмена
        </button>
      </div>
    </div>
  )
}

interface CancelPanelProps {
  lessonId: number
  onDone: () => void
  onCancel: () => void
}

function CancelPanel({ lessonId, onDone, onCancel }: CancelPanelProps) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  async function confirm() {
    setBusy(true)
    const res = await api.invoke('substitutions:cancel', { lessonId, reason: reason || null })
    setBusy(false)
    if (res.ok) {
      notifySuccess('Занятие отменено')
      onDone()
    } else {
      notifyError(res.error.message)
    }
  }

  return (
    <div className="subpanel-add">
      <div className="form-field">
        <label>Причина отмены</label>
        <input type="text" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Больничный, праздник…" />
      </div>
      <div className="dialog-actions">
        <button type="button" className="btn" onClick={onCancel}>
          Назад
        </button>
        <button type="button" className="btn btn-danger" disabled={busy} onClick={() => void confirm()}>
          Да, отменить занятие
        </button>
      </div>
    </div>
  )
}

interface MovePanelProps {
  lessonId: number
  rooms: Room[]
  onDone: () => void
  onCancel: () => void
}

function MovePanel({ lessonId, rooms, onDone, onCancel }: MovePanelProps) {
  const [newDate, setNewDate] = useState('')
  const [newPairNo, setNewPairNo] = useState(1)
  const [newRoomId, setNewRoomId] = useState<number | ''>('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  async function confirm() {
    if (!newDate) {
      notifyError('Укажите новую дату')
      return
    }
    setBusy(true)
    const res = await api.invoke('substitutions:move', {
      lessonId,
      newDate,
      newPairNo,
      newRoomId: newRoomId === '' ? null : newRoomId,
      reason: reason || null,
    })
    setBusy(false)
    if (res.ok) {
      notifySuccess('Занятие перенесено')
      onDone()
    } else {
      notifyError(res.error.message)
    }
  }

  return (
    <div className="subpanel-add">
      <div className="form-field">
        <label>Новая дата</label>
        <input type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} />
      </div>
      <div className="form-field">
        <label>Новая пара</label>
        <select value={newPairNo} onChange={(e) => setNewPairNo(Number(e.target.value))}>
          {[1, 2, 3, 4, 5, 6].map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </div>
      <div className="form-field">
        <label>Кабинет</label>
        <select value={newRoomId} onChange={(e) => setNewRoomId(e.target.value === '' ? '' : Number(e.target.value))}>
          <option value="">Как было</option>
          {rooms.map((r) => (
            <option key={r.id} value={r.id}>
              {r.number}
            </option>
          ))}
        </select>
      </div>
      <div className="form-field">
        <label>Причина переноса</label>
        <input type="text" value={reason} onChange={(e) => setReason(e.target.value)} />
      </div>
      <div className="dialog-actions">
        <button type="button" className="btn" onClick={onCancel}>
          Назад
        </button>
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void confirm()}>
          Перенести
        </button>
      </div>
    </div>
  )
}

type ActionKind = 'swap' | 'cancel' | 'move'

/**
 * Мастер замены (§этап 7 PLAN.md, §1.1 п.22/29): выбрать заболевшего → период → для каждого
 * занятия — заменить / отменить / перенести. Работает над материализованными `lesson`
 * (не над `template_entry`) — первый экран, показывающий расписание по конкретным датам.
 */
export function SubstitutionWizardPage() {
  const [teachers, setTeachers] = useState<Teacher[]>([])
  const [rooms, setRooms] = useState<Room[]>([])
  const [teacherId, setTeacherId] = useState<number | ''>('')
  const [dateFrom, setDateFrom] = useState(() => new Date().toISOString().slice(0, 10))
  const [dateTo, setDateTo] = useState(() => new Date(Date.now() + 13 * 86_400_000).toISOString().slice(0, 10))
  const [lessons, setLessons] = useState<TeacherLessonRow[] | null>(null)
  const [active, setActive] = useState<{ lessonId: number; kind: ActionKind } | null>(null)

  useEffect(() => {
    void api.invoke('teachers:list', {}).then((res) => {
      if (res.ok) setTeachers(res.value)
    })
    void api.invoke('rooms:list', {}).then((res) => {
      if (res.ok) setRooms(res.value)
    })
  }, [])

  async function loadLessons(forTeacherId?: number) {
    const target = forTeacherId ?? teacherId
    if (target === '') {
      notifyError('Выберите преподавателя')
      return
    }
    setActive(null)
    const res = await api.invoke('substitutions:teacherLessons', { teacherId: target, dateFrom, dateTo })
    if (res.ok) setLessons(res.value)
    else notifyError(res.error.message)
  }

  function afterApplied() {
    setActive(null)
    void loadLessons()
  }

  return (
    <div>
      <div className="page-header">
        <h1>Замены</h1>
        <div className="toolbar-actions">
          <select value={teacherId} onChange={(e) => setTeacherId(e.target.value === '' ? '' : Number(e.target.value))}>
            <option value="">Преподаватель…</option>
            {teachers.map((t) => (
              <option key={t.id} value={t.id}>
                {teacherFullName(t)}
              </option>
            ))}
          </select>
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          <button type="button" className="btn btn-primary" onClick={() => void loadLessons()}>
            Показать занятия
          </button>
        </div>
      </div>

      {lessons == null ? (
        <p className="history-empty">Выберите преподавателя и период, затем нажмите «Показать занятия»</p>
      ) : lessons.length === 0 ? (
        <p className="history-empty">В этот период занятий нет</p>
      ) : (
        <div className="subpanel">
          {lessons.map((l) => {
            // Повторная замена того же занятия разрешена (заменивший тоже может заболеть);
            // закрыты только уже отданные другому, отменённые и перенесённые.
            const canAct = l.status === 'planned' && !l.handedOver
            const isActive = active?.lessonId === l.lessonId
            return (
              <div key={l.lessonId}>
                <div className="subpanel-row">
                  <span>
                    {l.date}, пара {l.pairNo} — <b>{l.disciplineName}</b>, {l.targetLabel}
                    {l.roomLabel ? ` · ауд. ${l.roomLabel}` : ''}
                  </span>
                  <span>
                    <span className="badge">{STATUS_LABEL[l.status]}</span>
                    {l.substitutionNote && <span className="badge">{l.substitutionNote}</span>}
                    {/* Переданное по замене занятие ведёт уже другой преподаватель, и действия
                        над ним доступны в его списке. Без этой кнопки строка выглядела тупиком:
                        отменить ошибочную замену было неоткуда. */}
                    {l.handedOver && l.status === 'planned' && (
                      <button
                        type="button"
                        className="btn-link"
                        onClick={() => {
                          setTeacherId(l.currentTeacherId)
                          void loadLessons(l.currentTeacherId)
                        }}
                      >
                        Открыть у {l.currentTeacherName}
                      </button>
                    )}
                    {canAct && (
                      <>
                        <button type="button" className="btn-link" onClick={() => setActive({ lessonId: l.lessonId, kind: 'swap' })}>
                          Заменить
                        </button>
                        <button type="button" className="btn-link" onClick={() => setActive({ lessonId: l.lessonId, kind: 'cancel' })}>
                          Отменить
                        </button>
                        <button type="button" className="btn-link" onClick={() => setActive({ lessonId: l.lessonId, kind: 'move' })}>
                          Перенести
                        </button>
                      </>
                    )}
                  </span>
                </div>
                {isActive && active.kind === 'swap' && <SwapPanel lessonId={l.lessonId} onDone={afterApplied} onCancel={() => setActive(null)} />}
                {isActive && active.kind === 'cancel' && <CancelPanel lessonId={l.lessonId} onDone={afterApplied} onCancel={() => setActive(null)} />}
                {isActive && active.kind === 'move' && (
                  <MovePanel lessonId={l.lessonId} rooms={rooms} onDone={afterApplied} onCancel={() => setActive(null)} />
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
