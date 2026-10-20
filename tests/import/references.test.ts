import { describe, expect, it } from 'vitest'
import { matchesPersonName } from '../../src/shared/import/engine'
import { SPECIALITY_CATALOG, parseGroupName, splitPersonName } from '../../src/shared/import/references'

const codes = SPECIALITY_CATALOG.map((s) => s.code)

describe('разбор имени группы (решения п. 41, 45)', () => {
  it('узнаёт бюджет и контракт, двух- и однобуквенный код', () => {
    expect(parseGroupName('СД-21', codes)).toEqual({ funding: 'budget', specialityCode: 'СД', course: 2 })
    expect(parseGroupName('КСД-22', codes)).toEqual({ funding: 'contract', specialityCode: 'СД', course: 2 })
    expect(parseGroupName('Л-31', codes)).toEqual({ funding: 'budget', specialityCode: 'Л', course: 3 })
    expect(parseGroupName('КЛ-11', codes)).toEqual({ funding: 'contract', specialityCode: 'Л', course: 1 })
    expect(parseGroupName('КЛД-43 ', codes)).toEqual({ funding: 'contract', specialityCode: 'ЛД', course: 4 })
  })

  it('не угадывает неизвестный код и имя без курса', () => {
    expect(parseGroupName('ХЗ-21', codes)).toBeNull()
    expect(parseGroupName('СД', codes)).toBeNull()
    expect(parseGroupName('Хирургия', codes)).toBeNull()
  })
})

describe('ФИО из файла нагрузки → карточка преподавателя', () => {
  it('сохраняет инициалы с точкой и частицу фамилии', () => {
    expect(splitPersonName('Янхаева З.')).toEqual({ lastName: 'Янхаева', firstName: 'З.', middleName: null })
    expect(splitPersonName('Абдуллаева М.Н')).toEqual({ lastName: 'Абдуллаева', firstName: 'М.', middleName: 'Н.' })
    expect(splitPersonName('Омуркул к. К.')).toEqual({ lastName: 'Омуркул кызы', firstName: 'К.', middleName: null })
    expect(splitPersonName('Иванова Татьяна Петровна')).toEqual({ lastName: 'Иванова', firstName: 'Татьяна', middleName: 'Петровна' })
    expect(splitPersonName('Мамралиева')).toBeNull()
  })

  it('заведённая карточка находится по той же строке файла', () => {
    for (const text of ['Янхаева З.', 'Абдуллаева М.Н', 'Омуркул к. К.', 'Кубатова А. ']) {
      const p = splitPersonName(text)!
      expect([text, matchesPersonName(text, p.lastName, p.firstName)]).toEqual([text, true])
    }
  })
})
