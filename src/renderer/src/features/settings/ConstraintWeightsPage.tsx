import { useCallback, useEffect, useState } from 'react'
import type { ConstraintWeightRow } from '../../../../shared/ipc/contract'
import { WEIGHT_PROFILES, weightKeyForCode } from '../../../../shared/schedule/weights'
import { api } from '../../api/client'
import { EntityHistoryPanel } from '../../ui/EntityHistoryPanel'
import { ruCommon } from '../../ui/locale'
import { notifyError, notifySuccess } from '../../ui/toast'

interface RowDraft {
  id: number
  code: string
  rowVersion: number
  weight: number
  enabled: boolean
  titleRu: string
  descriptionRu: string | null
}

function toDrafts(rows: ConstraintWeightRow[]): RowDraft[] {
  return rows.map((r) => ({ id: r.id, code: r.code, rowVersion: r.rowVersion, weight: r.weight, enabled: r.enabled, titleRu: r.titleRu, descriptionRu: r.descriptionRu }))
}

/**
 * Веса мягких критериев солвера (§5.5, §6 этап 6 PLAN.md): ползунки 0..100 с русскими
 * подписями, профили и сброс к значениям по умолчанию. Ноль = критерий выключен полностью.
 */
export function ConstraintWeightsPage() {
  const [drafts, setDrafts] = useState<RowDraft[] | null>(null)
  const [historyId, setHistoryId] = useState<number | null>(null)

  const refresh = useCallback(
    () =>
      api.invoke('constraintWeights:list', {}).then((res) => {
        if (res.ok) setDrafts(toDrafts(res.value))
        else notifyError(res.error.message)
      }),
    [],
  )

  useEffect(() => {
    void refresh()
  }, [refresh])

  function updateDraft(id: number, patch: Partial<RowDraft>) {
    setDrafts((prev) => (prev ?? []).map((d) => (d.id === id ? { ...d, ...patch } : d)))
  }

  function applyProfile(profileCode: string) {
    const profile = WEIGHT_PROFILES.find((p) => p.code === profileCode)
    if (!profile) return
    setDrafts((prev) =>
      (prev ?? []).map((d) => {
        const key = weightKeyForCode(d.code)
        return key ? { ...d, weight: profile.weights[key], enabled: true } : d
      }),
    )
  }

  async function save() {
    if (!drafts) return
    const rows = drafts.map((d) => ({ id: d.id, rowVersion: d.rowVersion, weight: d.weight, enabled: d.enabled }))
    const res = await api.invoke('constraintWeights:save', { rows })
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
        <h1>Веса мягких критериев</h1>
      </div>
      <p className="history-empty">
        Влияют только на качество расписания при локальном поиске (этап 6) — жёсткие ограничения (двойное занятие,
        переполненный кабинет и т.п.) нарушить нельзя ни при каком весе. Ноль — критерий выключен.
      </p>

      {drafts === null && <p className="history-empty">{ruCommon.loading}</p>}

      {drafts && (
        <>
          <div className="page-toolbar">
            <span>Профили:</span>
            {WEIGHT_PROFILES.map((p) => (
              <button key={p.code} type="button" className="btn" onClick={() => applyProfile(p.code)}>
                {p.titleRu}
              </button>
            ))}
          </div>

          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Критерий</th>
                  <th>Вес</th>
                  <th>Активен</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {drafts.map((d) => (
                  <tr key={d.id}>
                    <td>
                      <div>{d.titleRu}</div>
                      {d.descriptionRu && <div className="history-empty">{d.descriptionRu}</div>}
                    </td>
                    <td>
                      <div className="weight-slider">
                        <input
                          type="range"
                          min={0}
                          max={100}
                          value={d.weight}
                          disabled={!d.enabled}
                          onChange={(e) => updateDraft(d.id, { weight: Number(e.target.value) })}
                        />
                        <span className="weight-value">{d.weight}</span>
                      </div>
                    </td>
                    <td>
                      <input type="checkbox" checked={d.enabled} onChange={(e) => updateDraft(d.id, { enabled: e.target.checked })} />
                    </td>
                    <td>
                      <button type="button" className="btn-link" onClick={() => setHistoryId((prev) => (prev === d.id ? null : d.id))}>
                        {historyId === d.id ? 'Скрыть историю' : 'История'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <div className="page-toolbar">
        <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={!drafts}>
          {ruCommon.save}
        </button>
      </div>
      {historyId != null && <EntityHistoryPanel entity="constraint_weight" id={historyId} />}
    </div>
  )
}
