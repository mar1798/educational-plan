/**
 * Печатная форма расписания группы (§5.11 PLAN.md): HTML + `@media print`-совместимая
 * вёрстка, отрисованная `webContents.printToPDF` в скрытом окне — A4, без обрезки.
 */
import { mkdtemp, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { BrowserWindow } from 'electron'
import { templateEntriesView, type TemplateEntryView } from '../db/repo/schedule-template'
import type { DbLike } from '../db/repo/types'
import { pairGrid } from '../db/schema/org'
import { studyGroup } from '../db/schema/people'

const WEEKDAY_LABEL: Record<number, string> = {
  1: 'Понедельник',
  2: 'Вторник',
  3: 'Среда',
  4: 'Четверг',
  5: 'Пятница',
  6: 'Суббота',
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function cellHtml(entries: TemplateEntryView[], day: number, pairNo: number): string {
  return entries
    .filter((e) => e.dayOfWeek === day && e.pairNo === pairNo)
    .map((e) => {
      const who = e.attendees.map((a) => (a.subgroupNo != null ? `${a.groupName} п/гр ${a.subgroupNo}` : a.groupName)).join(', ')
      const room = e.roomLabel ? ` · ауд. ${escapeHtml(e.roomLabel)}` : ''
      const parity = e.weekParity === 'odd' ? ' (нечёт.)' : e.weekParity === 'even' ? ' (чёт.)' : ''
      return `<div class="entry"><b>${escapeHtml(e.disciplineName)}</b>${parity}<br>${escapeHtml(e.teacherName)} · ${escapeHtml(who)}${room}</div>`
    })
    .join('')
}

function buildHtml(title: string, entries: TemplateEntryView[], pairNumbers: number[]): string {
  const rows = pairNumbers
    .map((p) => `<tr><td class="pair">${p}</td>${[1, 2, 3, 4, 5, 6].map((d) => `<td>${cellHtml(entries, d, p)}</td>`).join('')}</tr>`)
    .join('')
  const headCells = [1, 2, 3, 4, 5, 6].map((d) => `<th>${WEEKDAY_LABEL[d]}</th>`).join('')

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  @page { size: A4 landscape; margin: 10mm; }
  body { font-family: Arial, sans-serif; font-size: 10px; margin: 0; }
  h1 { font-size: 16px; margin: 0 0 8px; }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  th, td { border: 1px solid #999; padding: 4px; vertical-align: top; word-wrap: break-word; }
  th { background: #eee; }
  .pair { text-align: center; width: 24px; }
  .entry { margin-bottom: 4px; }
</style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  <table>
    <thead><tr><th></th>${headCells}</tr></thead>
    <tbody>${rows}</tbody>
  </table>
</body>
</html>`
}

export async function printGroupScheduleToPdf(tx: DbLike, templateId: number, groupId: number, filePath: string): Promise<void> {
  const entries = templateEntriesView(tx, templateId).filter((e) => e.attendees.some((a) => a.groupId === groupId))
  const group = tx.select().from(studyGroup).where(eq(studyGroup.id, groupId)).get()
  const pairGridRows = tx.select().from(pairGrid).all()
  // ensurePairGrid() гарантирует непустую сетку при старте приложения (§2.8).
  const pairNumbers =
    pairGridRows.length === 0
      ? [1, 2, 3, 4, 5, 6]
      : pairGridRows.filter((p) => p.enabled).sort((a, b) => a.pairNo - b.pairNo).map((p) => p.pairNo)

  const html = buildHtml(`Расписание ${group?.name ?? `#${groupId}`}`, entries, pairNumbers)

  const dir = await mkdtemp(join(tmpdir(), 'eduplan-print-'))
  const htmlPath = join(dir, 'schedule.html')
  await writeFile(htmlPath, html, 'utf-8')

  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true } })
  try {
    await win.loadFile(htmlPath)
    const pdf = await win.webContents.printToPDF({ landscape: true, pageSize: 'A4', printBackground: true })
    await writeFile(filePath, pdf)
  } finally {
    win.destroy()
    await unlink(htmlPath).catch(() => {})
  }
}
