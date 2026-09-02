import { useEffect, useState } from 'react'
import { api } from '../api/client'

const SETTINGS_KEY = 'demo-note'

export function App() {
  const [note, setNote] = useState('')
  const [savedNote, setSavedNote] = useState<string | null>(null)
  const [jobId, setJobId] = useState<string | null>(null)
  const [progress, setProgress] = useState<number | null>(null)
  const [result, setResult] = useState<string | null>(null)

  useEffect(() => {
    void api.invoke('settings:get', { key: SETTINGS_KEY }).then((res) => {
      if (res.ok) setSavedNote(res.value.value)
    })
  }, [])

  useEffect(() => {
    const offProgress = api.on('demo:compute:progress', (payload) => {
      if (payload.jobId === jobId) setProgress(payload.percent)
    })
    const offDone = api.on('demo:compute:done', (payload) => {
      if (payload.jobId === jobId) {
        setResult(`расставлено: ${payload.placed}, штраф: ${payload.penalty}`)
        setJobId(null)
        setProgress(null)
      }
    })
    return () => {
      offProgress()
      offDone()
    }
  }, [jobId])

  async function saveNote() {
    const res = await api.invoke('settings:set', { key: SETTINGS_KEY, value: note })
    if (res.ok) setSavedNote(note)
  }

  async function startCompute() {
    setResult(null)
    const res = await api.invoke('demo:compute:start', { seed: 1 })
    if (res.ok) setJobId(res.value.jobId)
  }

  async function cancelCompute() {
    if (!jobId) return
    await api.invoke('demo:compute:cancel', { jobId })
    setJobId(null)
    setProgress(null)
  }

  return (
    <main>
      <h1>Работает</h1>

      <section>
        <h2>Настройки (SQLite через IPC)</h2>
        <p>Сохранено: {savedNote ?? '(пусто)'}</p>
        <input value={note} onChange={(e) => setNote(e.target.value)} />
        <button onClick={() => void saveNote()}>Сохранить</button>
      </section>

      <section>
        <h2>Заготовка utilityProcess</h2>
        <button onClick={() => void startCompute()} disabled={jobId !== null}>
          Посчитать
        </button>
        <button onClick={() => void cancelCompute()} disabled={jobId === null}>
          Отмена
        </button>
        {progress !== null && <p>Прогресс: {progress}%</p>}
        {result && <p>{result}</p>}
      </section>
    </main>
  )
}
