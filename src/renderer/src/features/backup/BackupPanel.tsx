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
      <h2>Резервные копии</h2>

      <p>
        Копия на внешний носитель:{' '}
        {externalAt ? formatDate(externalAt) : 'ни разу не сохранялась'}
        {isStale && <strong> — прошло больше недели, сохраните копию на флешку</strong>}
      </p>
      <button onClick={() => void saveExternal()}>Сохранить копию в выбранную папку</button>
      <button onClick={() => void createManual()}>Создать бэкап</button>

      {message && <p>{message}</p>}

      <ul>
        {backups.map((b) => (
          <li key={b.id}>
            {formatDate(b.createdAt)} — {REASON_RU[b.reason]}, {formatSize(b.sizeBytes)}
            {pendingRestore === b.fileName ? (
              <>
                {' '}
                <strong>Заменить текущую базу этой копией?</strong>{' '}
                <button onClick={() => void restore(b.fileName)}>Да, восстановить</button>{' '}
                <button onClick={() => setPendingRestore(null)}>Отмена</button>
              </>
            ) : (
              <>
                {' '}
                <button onClick={() => setPendingRestore(b.fileName)}>Восстановить</button>
              </>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
