import { z } from 'zod'

export const settingsGetInput = z.object({ key: z.string().min(1) })
export const settingsGetOutput = z.object({ value: z.string().nullable() })

export const settingsSetInput = z.object({ key: z.string().min(1), value: z.string() })
export const settingsSetOutput = z.object({ ok: z.literal(true) })

export const demoComputeStartInput = z.object({ seed: z.number().int() })
export const demoComputeStartOutput = z.object({ jobId: z.string() })

export const demoComputeCancelInput = z.object({ jobId: z.string() })
export const demoComputeCancelOutput = z.object({ ok: z.literal(true) })
