import type { ConstraintWeightRow } from '../../shared/ipc/contract'
import { constraintWeightsListInput, constraintWeightsSaveInput } from '../../shared/ipc/schemas'
import type { Db } from '../db/client'
import { listConstraintWeights, updateConstraintWeightRow } from '../db/repo/constraint-weights'
import { handle } from './register'

export function registerConstraintWeightsHandlers(db: Db) {
  handle('constraintWeights:list', constraintWeightsListInput, () => {
    return listConstraintWeights(db) as unknown as ConstraintWeightRow[]
  })

  handle('constraintWeights:save', constraintWeightsSaveInput, ({ rows }) => {
    return db.transaction((tx) =>
      rows.map((row) => updateConstraintWeightRow(tx, row, { reason: 'правка весов ограничений расписания' }) as unknown as ConstraintWeightRow),
    )
  })
}
