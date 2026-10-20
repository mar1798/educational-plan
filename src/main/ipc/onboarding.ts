import { onboardingStatusInput } from '../../shared/ipc/schemas'
import type { Db } from '../db/client'
import { onboardingStatus } from '../db/repo/onboarding'
import { handle } from './register'

export function registerOnboardingHandlers(db: Db) {
  handle('onboarding:status', onboardingStatusInput, () => onboardingStatus(db))
}
