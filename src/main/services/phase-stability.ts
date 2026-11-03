/**
 * Стабильность между фазами (§этап Д): если лекции стоят в понедельник 1-й парой в фазе 1, то в фазе 2
 * они должны остаться там же, иначе расписание прыгает на границе фаз. Слоты занятий продолжающейся
 * нагрузки из предыдущей фазы передаются в солвер как предпочтительные (`Unit.preferredSlot`), а
 * мягкий вес `phaseStability` штрафует за перенос.
 */
import type { SolverInput, SolverOutput } from '../../solver/model'

export function applyPreferredSlots(next: SolverInput, previous: { input: SolverInput; output: SolverOutput }): number {
  const prevUnits = new Map(previous.input.units.map((u) => [u.id, u]))
  const slotsByLoad = new Map<number, number[]>()
  for (const a of previous.output.assignments) {
    const unit = prevUnits.get(a.unitId)
    if (!unit) continue
    const list = slotsByLoad.get(unit.loadIdx) ?? []
    list.push(a.slot)
    slotsByLoad.set(unit.loadIdx, list)
  }
  for (const list of slotsByLoad.values()) list.sort((a, b) => a - b)

  // Занятия одной нагрузки сопоставляются по порядку: у них одинаковый вид, различить их нечем.
  const taken = new Map<number, number>()
  let matched = 0
  for (const unit of next.units) {
    const list = slotsByLoad.get(unit.loadIdx)
    if (!list) continue
    const i = taken.get(unit.loadIdx) ?? 0
    if (i >= list.length) continue
    unit.preferredSlot = list[i]
    taken.set(unit.loadIdx, i + 1)
    matched++
  }
  return matched
}
