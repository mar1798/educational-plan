import { useEffect, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import type { OnboardingStatus, OnboardingStepKey } from '../../../../shared/ipc/contract'
import { api } from '../../api/client'
import { notifyError } from '../../ui/toast'

/** Тексты шагов — только подача; готовность каждого шага считает main (onboarding:status). */
const STEP_TEXT: Record<OnboardingStepKey, { title: string; why: string; path: string; action: string }> = {
  calendar: {
    title: 'Учебный год и семестры',
    why: 'Нагрузка и расписание привязаны к семестру. Заведите учебный год, затем оба его семестра.',
    path: '/academic-years',
    action: 'Учебные годы',
  },
  specialities: {
    title: 'Специальности',
    why: 'По коду в имени группы («СД-21», «КСД-21») программа узнаёт специальность и срок обучения.',
    path: '/specialities',
    action: 'Специальности',
  },
  disciplines: { title: 'Дисциплины', why: 'Из них состоят учебные планы и нагрузка.', path: '/disciplines', action: 'Дисциплины' },
  groups: {
    title: 'Группы',
    why: 'Курс, год набора и численность: по ним выбирается учебный план и предлагается деление на подгруппы.',
    path: '/groups',
    action: 'Группы',
  },
  teachers: { title: 'Преподаватели', why: 'Категория (штат, внештат, почасовик) определяет норму часов.', path: '/teachers', action: 'Преподаватели' },
  curricula: {
    title: 'Учебные планы',
    why: 'План специальности и года набора по семестрам — к его строкам привязывается нагрузка группы.',
    path: '/curricula',
    action: 'Учебные планы',
  },
  qualifications: {
    title: 'Квалификации преподавателей',
    why: 'Какие дисциплины может вести преподаватель: без квалификации нагрузку не назначить. Задаются в карточке преподавателя.',
    path: '/teachers',
    action: 'Преподаватели',
  },
  load: { title: 'Нагрузка', why: 'Кто, в какой группе, что и сколько часов ведёт в семестре — из этого строится расписание.', path: '/teaching-load', action: 'Нагрузка' },
  rooms: { title: 'Корпуса и кабинеты', why: 'Куда ставить занятия; клинические базы — отдельные корпуса.', path: '/rooms', action: 'Кабинеты' },
  pairGrid: { title: 'Сетка звонков', why: 'Время пар для печати расписания.', path: '/pair-grid', action: 'Сетка звонков' },
  schedule: { title: 'Расписание', why: 'Когда всё выше готово — генерация шаблона недели.', path: '/generation', action: 'Генерация' },
}

/** Шаги, которые закрывает импорт годовой нагрузки вместе с «Завести недостающее». */
const COVERED_BY_IMPORT: OnboardingStepKey[] = ['specialities', 'disciplines', 'groups', 'teachers', 'curricula', 'qualifications', 'load']

/** `'failed'` — статус не получен: без этого различия экран оставался пустым навсегда. */
function useOnboardingStatus(): OnboardingStatus | 'failed' | null {
  const [status, setStatus] = useState<OnboardingStatus | 'failed' | null>(null)
  useEffect(() => {
    void api.invoke('onboarding:status', {}).then((res) => {
      if (res.ok) {
        setStatus(res.value)
      } else {
        notifyError(res.error.message)
        setStatus('failed')
      }
    })
  }, [])
  return status
}

/**
 * Экран «С чего начать». Дистрибутив ставится с пустой базой, а порядок заполнения из
 * меню не виден: группе нужен план, нагрузке — квалификация. Здесь он выписан по шагам,
 * со статусом по данным и коротким путём — импортом годовой нагрузки.
 */
export function OnboardingPage() {
  const status = useOnboardingStatus()
  if (!status) return null
  if (status === 'failed') {
    return (
      <div>
        <div className="page-header">
          <h1>С чего начать</h1>
        </div>
        <p className="history-empty">Не удалось проверить, что уже заполнено. Разделы доступны из меню слева.</p>
      </div>
    )
  }

  const calendarReady = status.steps.find((s) => s.key === 'calendar')?.status === 'done'
  const importPending = status.steps.some((s) => COVERED_BY_IMPORT.includes(s.key) && s.status === 'todo')
  // Выделен только следующий шаг: десяток одинаковых синих кнопок не подсказывает, куда идти.
  const nextStep = status.steps.find((s) => s.status === 'todo')?.key

  return (
    <div>
      <div className="page-header">
        <h1>С чего начать</h1>
        <div className="toolbar-actions">
          <span className="badge">{status.ready ? 'Можно генерировать расписание' : 'Заполнено не всё'}</span>
        </div>
      </div>

      {importPending && (
        <div className="card onboarding-shortcut">
          <h3>Есть файл годовой нагрузки?</h3>
          <p>
            Шаги со специальностями, дисциплинами, группами, преподавателями, планами, квалификациями и нагрузкой можно пройти одним
            файлом. Мастер импорта уже настроен под годовую нагрузку колледжа (листы «Бюджет» и «Контракт»): он покажет, чего не хватает в
            справочниках, и заведёт это из файла — после вашего подтверждения.
          </p>
          {calendarReady ? (
            <Link className="btn btn-primary" to="/import?preset=annual-load">
              Импортировать годовую нагрузку
            </Link>
          ) : (
            <p className="history-empty">Сначала заведите учебный год и семестры (шаг 1) — нагрузка загружается в семестр.</p>
          )}
        </div>
      )}

      <div className="card">
        <ol className="onboarding-steps">
          {status.steps.map((step, i) => {
            const text = STEP_TEXT[step.key]
            return (
              <li key={step.key} className={`onboarding-step onboarding-step-${step.status}`}>
                <span className="onboarding-mark" aria-label={step.status === 'done' ? 'готово' : step.status === 'review' ? 'проверить' : 'не сделано'}>
                  {step.status === 'done' ? '✓' : step.status === 'review' ? '!' : i + 1}
                </span>
                <div className="onboarding-body">
                  <div className="onboarding-title">{text.title}</div>
                  <div className="onboarding-why">{text.why}</div>
                  <div className="onboarding-summary">{step.summary}</div>
                  {step.issue && <div className="onboarding-issue">{step.issue}</div>}
                </div>
                <Link className={step.key === nextStep && !importPending ? 'btn btn-primary btn-sm' : 'btn btn-sm'} to={text.path}>
                  {text.action}
                </Link>
              </li>
            )
          })}
        </ol>
      </div>
    </div>
  )
}

/**
 * Стартовая страница: пока обязательные шаги не пройдены, приложение открывается на
 * «С чего начать», а не на пустом справочнике специальностей.
 */
export function StartRedirect() {
  const status = useOnboardingStatus()
  if (!status) return null
  // Статус не получен — открываемся как раньше, на справочнике, а не на пустом экране.
  return <Navigate to={status === 'failed' || status.ready ? '/specialities' : '/start'} replace />
}
