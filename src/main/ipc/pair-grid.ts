import { asc } from 'drizzle-orm'
import type { PairGridRow } from '../../shared/ipc/contract'
import { pairGridListInput, pairGridSaveInput } from '../../shared/ipc/schemas'
import type { Db } from '../db/client'
import { updatePairGridRow } from '../db/repo/pair-grid'
import { pairGrid } from '../db/schema/org'
import { handle } from './register'

export function registerPairGridHandlers(db: Db) {
  handle('pairGrid:list', pairGridListInput, () => {
    return db.select().from(pairGrid).orderBy(asc(pairGrid.pairNo)).all() as unknown as PairGridRow[]
  })

  handle('pairGrid:save', pairGridSaveInput, ({ rows }) => {
    return db.transaction((tx) =>
      rows.map((row) => updatePairGridRow(tx, row, { reason: 'правка сетки звонков' }) as unknown as PairGridRow),
    )
  })
}
