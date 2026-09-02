import { useCallback, useEffect, useState } from 'react'
import type { ChangeLogEntry } from '../../../shared/ipc/contract'
import { api } from '../api/client'

interface EntityHistoryPanelProps {
  entity: string
  id: number
}

const ACTION_RU: Record<ChangeLogEntry['action'], string> = {
  create: 'создано',
  update: 'изменено',
  close: 'закрыто',
  delete: 'удалено',
}

const SKIP_KEYS = new Set(['id', 'createdAt', 'updatedAt', 'rowVersion'])

function diffFields(beforeJson: string | null, afterJson: string | null): string[] {
  const before = beforeJson ? (JSON.parse(beforeJson) as Record<string, unknown>) : {}
  const after = afterJson ? (JSON.parse(afterJson) as Record<string, unknown>) : {}
  const keys = new Set([...Object.keys(before), ...Object.keys(after)])
  const lines: string[] = []
  for (const key of keys) {
    if (SKIP_KEYS.has(key)) continue
    const b = before[key]
    const a = after[key]
    if (JSON.stringify(b) !== JSON.stringify(a)) {
      lines.push(`${key}: ${b === undefined ? '—' : String(b)} → ${a === undefined ? '—' : String(a)}`)
    }
  }
  return lines
}

/** Задача 2.10: «Кто менял?» — переиспользуется на карточке любой сущности. */
export function EntityHistoryPanel({ entity, id }: EntityHistoryPanelProps) {
  const [entries, setEntries] = useState<ChangeLogEntry[] | null>(null)

  const load = useCallback(
    () =>
      api.invoke('audit:entity', { entity, id }).then((res) => {
        if (res.ok) setEntries(res.value)
      }),
    [entity, id],
  )

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="history-panel">
      <h3>История изменений</h3>
      {entries === null && <p className="history-empty">Загрузка…</p>}
      {entries?.length === 0 && <p className="history-empty">Изменений ещё не было</p>}
      {entries?.map((entry) => {
        const diff = diffFields(entry.beforeJson, entry.afterJson)
        return (
          <div key={entry.id} className="history-entry">
            <div className="history-entry-meta">
              {new Date(entry.at).toLocaleString('ru-RU')} — {entry.user} — {ACTION_RU[entry.action]}
              {entry.reason && ` (${entry.reason})`}
            </div>
            {diff.length > 0 && (
              <ul>
                {diff.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            )}
          </div>
        )
      })}
    </div>
  )
}
