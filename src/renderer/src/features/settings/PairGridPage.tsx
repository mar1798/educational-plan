import { useCallback, useEffect, useState } from 'react'
import type { PairGridRow } from '../../../../shared/ipc/contract'
import { api } from '../../api/client'
import { EntityHistoryPanel } from '../../ui/EntityHistoryPanel'
import { ruCommon } from '../../ui/locale'
import { notifyError, notifySuccess } from '../../ui/toast'

interface RowDraft {
  pairNo: number
  rowVersion: number
  startsAt: string
  endsAt: string
  academicHours: string
  enabled: boolean
}

function toDrafts(rows: PairGridRow[]): RowDraft[] {
  return rows.map((r) => ({
    pairNo: r.pairNo,
    rowVersion: r.rowVersion,
    startsAt: r.startsAt,
    endsAt: r.endsAt,
    academicHours: String(r.academicHours),
    enabled: r.enabled,
  }))
}

/**
 * Сетка звонков (§2.9): одна на весь колледж, до 6 пар, редактируется целиком.
 * Время пары используется везде через pair_grid, а не константу в коде (§2, §4 п.2) —
 * правка здесь одна на всё приложение, отдельного дублирования в других экранах нет.
 */
export function PairGridPage() {
  const [drafts, setDrafts] = useState<RowDraft[] | null>(null)
  const [historyPairNo, setHistoryPairNo] = useState<number | null>(null)

  const refresh = useCallback(
    () =>
      api.invoke('pairGrid:list', {}).then((res) => {
        if (res.ok) setDrafts(toDrafts(res.value))
        else notifyError(res.error.message)
      }),
    [],
  )

  useEffect(() => {
    void refresh()
  }, [refresh])

  function updateDraft(pairNo: number, patch: Partial<RowDraft>) {
    setDrafts((prev) => (prev ?? []).map((d) => (d.pairNo === pairNo ? { ...d, ...patch } : d)))
  }

  async function save() {
    if (!drafts) return
    const rows = drafts.map((d) => ({
      pairNo: d.pairNo,
      rowVersion: d.rowVersion,
      startsAt: d.startsAt,
      endsAt: d.endsAt,
      academicHours: Number(d.academicHours),
      enabled: d.enabled,
    }))
    if (rows.some((r) => !Number.isFinite(r.academicHours) || r.academicHours <= 0)) {
      notifyError('Число часов должно быть положительным')
      return
    }
    if (rows.some((r) => r.startsAt >= r.endsAt)) {
      notifyError('Время начала пары должно быть раньше времени окончания')
      return
    }
    const res = await api.invoke('pairGrid:save', { rows })
    if (res.ok) {
      notifySuccess(ruCommon.savedOk)
      await refresh()
    } else {
      notifyError(res.error.message)
    }
  }

  return (
    <div>
      <div className="page-header">
        <h1>Сетка звонков</h1>
      </div>
      {drafts === null && <p className="history-empty">{ruCommon.loading}</p>}
      {drafts && (
        <div className="data-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Пара</th>
                <th>Начало</th>
                <th>Окончание</th>
                <th>Часов</th>
                <th>Активна</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {drafts.map((d) => (
                <tr key={d.pairNo}>
                  <td>№{d.pairNo}</td>
                  <td>
                    <input type="time" value={d.startsAt} onChange={(e) => updateDraft(d.pairNo, { startsAt: e.target.value })} />
                  </td>
                  <td>
                    <input type="time" value={d.endsAt} onChange={(e) => updateDraft(d.pairNo, { endsAt: e.target.value })} />
                  </td>
                  <td>
                    <input
                      type="number"
                      min={1}
                      style={{ width: 60 }}
                      value={d.academicHours}
                      onChange={(e) => updateDraft(d.pairNo, { academicHours: e.target.value })}
                    />
                  </td>
                  <td>
                    <input type="checkbox" checked={d.enabled} onChange={(e) => updateDraft(d.pairNo, { enabled: e.target.checked })} />
                  </td>
                  <td>
                    <button
                      type="button"
                      className="btn-link"
                      onClick={() => setHistoryPairNo((prev) => (prev === d.pairNo ? null : d.pairNo))}
                    >
                      {historyPairNo === d.pairNo ? 'Скрыть историю' : 'История'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="page-toolbar">
        <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={!drafts}>
          {ruCommon.save}
        </button>
      </div>
      {historyPairNo != null && <EntityHistoryPanel entity="pair_grid" id={historyPairNo} />}
    </div>
  )
}
