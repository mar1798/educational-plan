import { z } from 'zod'

export const settingsGetInput = z.object({ key: z.string().min(1) })
export const settingsGetOutput = z.object({ value: z.string().nullable() })

export const settingsSetInput = z.object({ key: z.string().min(1), value: z.string() })
export const settingsSetOutput = z.object({ ok: z.literal(true) })

export const demoComputeStartInput = z.object({ seed: z.number().int() })
export const demoComputeStartOutput = z.object({ jobId: z.string() })

export const demoComputeCancelInput = z.object({ jobId: z.string() })
export const demoComputeCancelOutput = z.object({ ok: z.literal(true) })

const operationKind = z.enum(['generate', 'rollout', 'import', 'bulk_edit', 'restore'])

export const operationsListInput = z.object({ kind: operationKind.optional() })
export const operationsUndoInput = z.object({ operationId: z.number().int().positive() })

export const auditEntityInput = z.object({ entity: z.string().min(1), id: z.number().int().positive() })

export const backupListInput = z.object({})
export const backupCreateInput = z.object({ reason: z.literal('manual') })
export const backupRestoreInput = z.object({ fileName: z.string().min(1) })
export const backupExternalCopyInput = z.object({})
export const backupExternalStatusInput = z.object({})
