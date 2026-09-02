import { BackupPanel } from '../backup/BackupPanel'

export function SystemPage() {
  return (
    <div>
      <div className="page-header">
        <h1>Система</h1>
      </div>
      <div className="card">
        <BackupPanel />
      </div>
    </div>
  )
}
