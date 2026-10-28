import { beforeAll, describe, expect, it } from 'vitest'
import { teachingLoadSaveInput } from '../../src/shared/ipc/schemas'
import { describeIssue, installRuValidationMessages } from '../../src/shared/ipc/validation-messages'

// Конфиг zod глобален, но vitest изолирует файлы — на соседние тесты установка не влияет.
beforeAll(() => installRuValidationMessages())

function messagesOf(input: unknown): string[] {
  const parsed = teachingLoadSaveInput.safeParse(input)
  expect(parsed.success).toBe(false)
  return parsed.success ? [] : parsed.error.issues.map(describeIssue)
}

describe('русские сообщения проверки ввода', () => {
  it('незаполненное поле называется по-русски, а не ключом схемы', () => {
    const messages = messagesOf({ semesterId: 1 })
    expect(messages).toContain('«Преподаватель» — не заполнено')
    expect(messages.join(' ')).not.toMatch(/[A-Za-z]{4,}/)
  })

  it('ноль часов — понятное «больше 0», а не язык типов', () => {
    const messages = messagesOf({
      semesterId: 1,
      curriculumRowId: 1,
      teacherId: 1,
      groupId: 1,
      streamId: null,
      lessonKind: 'theory',
      hoursPlanned: 0,
      validFrom: '2026-09-01',
    })
    expect(messages.some((m) => m.startsWith('«Часы» — '))).toBe(true)
    expect(messages.join(' ')).not.toMatch(/number|expected/i)
  })

})
