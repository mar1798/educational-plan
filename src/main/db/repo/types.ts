import type { Db } from '../client'

// Тело db.transaction() получает объект с тем же query-билдером, что и Db —
// репозиторные функции работают одинаково внутри и вне транзакции.
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]
export type DbLike = Db | Tx
