import { getTableName, is } from 'drizzle-orm'
import { SQLiteTable } from 'drizzle-orm/sqlite-core'
import * as schema from '../schema'

// Универсальная таблица таблиц: operation_snapshot хранит table_name строкой,
// поэтому undo() и другие generic-операции резолвят Drizzle-таблицу по имени в рантайме
// вместо ручного перечисления всех 35 таблиц.
export const tableRegistry: Record<string, SQLiteTable> = Object.fromEntries(
  Object.values(schema)
    .filter((value) => is(value, SQLiteTable))
    .map((table) => [getTableName(table as SQLiteTable), table as SQLiteTable]),
)

export function resolveTable(tableName: string): SQLiteTable {
  const table = tableRegistry[tableName]
  if (!table) throw new Error(`Неизвестная таблица в snapshot: ${tableName}`)
  return table
}
