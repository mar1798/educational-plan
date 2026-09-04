import { useCallback, useEffect, useState } from 'react'
import type { BackupInfo } from '../../../../shared/ipc/contract'
import { api } from '../../api/client'
import { notifyError } from '../../ui/toast'

const REASON_RU: Record<BackupInfo['reason'], string> = {
  schedule: 'при запуске',
  pre_migration: 'перед миграцией',
  manual: 'вручную',
  pre_restore: 'перед восстановлением',
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('ru-RU')
}

function formatSize(bytes: number): string {
  return `${Math.max(1, Math.round(bytes / 1024))} КБ`
}

/** Задачи 1.7 и 1.7a: выбор бэкапа и восстановление из него, дата последней внешней копии с предупреждением. */
export function BackupPanel() {
  const [backups, setBackups] = useState<BackupInfo[]>([])
  const [externalAt, setExternalAt] = useState<string | null>(null)
  const [isStale, setIsStale] = useState(false)
  const [pendingRestore, setPendingRestore] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const refresh = useCallback(
    () =>
      Promise.all([api.invoke('backup:list', {}), api.invoke('backup:externalStatus', {})]).then(([list, status]) => {
        if (list.ok) setBackups(list.value)
        if (status.ok) {
          setExternalAt(status.value.lastExternalCopyAt)
          setIsStale(status.value.isStale)
        }
      }),
    [],
  )

  useEffect(() => {
    void refresh()
  }, [refresh])

  async function createManual() {
    const res = await api.invoke('backup:create', { reason: 'manual' })
    setMessage(res.ok ? `Бэкап создан: ${res.value.fileName}` : res.error.message)
    await refresh()
  }

  async function saveExternal() {
    const res = await api.invoke('backup:externalCopy', {})
    if (!res.ok) {
      setMessage(res.error.message)
    } else if ('cancelled' in res.value) {
      setMessage(null)
    } else {
      setMessage(`Копия сохранена: ${res.value.copiedTo}`)
    }
    await refresh()
  }

  async function restore(fileName: string) {
    // При успехе main перезапускает приложение и ответа не будет. А вот ошибка (файл бэкапа
    // пропал, диск заполнен) возвращается обычным результатом — раньше он выбрасывался, и
    // экран навсегда оставался с надписью «приложение сейчас перезапустится…».
    setMessage('Восстановление: приложение сейчас перезапустится…')
    const res = await api.invoke('backup:restore', { fileName })
    if (!res.ok) {
      setMessage(null)
      notifyError(res.error.message)
    }
  }

  return (
    <section>
      <h2 className="section-title">Резервные копии</h2>

      <p className={isStale ? 'backup-note backup-note-stale' : 'backup-note'}>
        Копия на внешний носитель: {externalAt ? formatDate(externalAt) : 'ни разу не сохранялась'}
        {isStale && <strong> — прошло больше недели, сохраните копию на флешку</strong>}
      </p>

      <div className="btn-group">
        <button type="button" className="btn btn-primary" onClick={() => void saveExternal()}>
          Сохранить копию в выбранную папку
        </button>
        <button type="button" className="btn" onClick={() => void createManual()}>
          Создать бэкап
        </button>
      </div>

      {message && <p className="backup-note">{message}</p>}

      {/* Список — строки одинаковой ширины с колонками: раньше это был <ul> с маркерами,
          и кнопка «Восстановить» у каждой копии стояла на своей случайной позиции. */}
      <div className="backup-list">
        {backups.length === 0 && <p className="history-empty">Копий пока нет</p>}
        {backups.map((b) => (
          <div className="backup-row" key={b.id}>
            <span className="backup-date">{formatDate(b.createdAt)}</span>
            <span className="badge">{REASON_RU[b.reason]}</span>
            <span className="backup-size">{formatSize(b.sizeBytes)}</span>
            {pendingRestore === b.fileName ? (
              <span className="backup-confirm">
                <strong>Заменить текущую базу этой копией?</strong>
                <button type="button" className="btn btn-sm btn-danger" onClick={() => void restore(b.fileName)}>
                  Да, восстановить
                </button>
                <button type="button" className="btn btn-sm" onClick={() => setPendingRestore(null)}>
                  Отмена
                </button>
              </span>
            ) : (
              <button type="button" className="btn btn-sm" onClick={() => setPendingRestore(b.fileName)}>
                Восстановить
              </button>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}
