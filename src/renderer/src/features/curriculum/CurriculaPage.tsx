import { zodResolver } from '@hookform/resolvers/zod'
import type { ColumnDef } from '@tanstack/react-table'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { z } from 'zod'
import type { Curriculum, Speciality } from '../../../../shared/ipc/contract'
import { curriculumSaveInput } from '../../../../shared/ipc/schemas'
import { api } from '../../api/client'
import { NumberField } from '../../ui/form/NumberField'
import { SelectField } from '../../ui/form/SelectField'
import { TextField } from '../../ui/form/TextField'
import { ruCommon } from '../../ui/locale'
import { ReferenceCrudPage, type ReferenceCrudAction } from '../../ui/ReferenceCrudPage'
import { notifyError, notifySuccess } from '../../ui/toast'
import { CopyCurriculumDialog } from './CopyCurriculumDialog'

type CurriculumFormValues = z.infer<typeof curriculumSaveInput>

const STATUS_LABEL: Record<Curriculum['status'], string> = {
  draft: 'Черновик',
  approved: 'Утверждён',
  archived: 'В архиве',
}

const defaultValues: CurriculumFormValues = { specialityId: 0, admissionYear: new Date().getFullYear(), name: '' }

/**
 * Учебные планы (§3.1–3.3): список планов по специальностям и годам набора.
 * Строки самого плана редактируются на отдельном экране (CurriculumEditorPage) —
 * здесь только карточка плана целиком: утверждение, архивация, копирование на новый набор.
 */
export function CurriculaPage() {
  const navigate = useNavigate()
  const [specialities, setSpecialities] = useState<Speciality[]>([])
  const [copySource, setCopySource] = useState<Curriculum | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    void api.invoke('specialities:list', {}).then((res) => {
      if (res.ok) setSpecialities(res.value)
    })
  }, [])

  const specialityName = (id: number) => specialities.find((s) => s.id === id)?.name ?? `#${id}`

  const columns: ColumnDef<Curriculum>[] = [
    { id: 'speciality', header: 'Специальность', accessorFn: (row) => specialityName(row.specialityId) },
    { accessorKey: 'name', header: 'Название плана' },
    { accessorKey: 'admissionYear', header: 'Год набора' },
    { id: 'status', header: 'Статус', cell: ({ row }) => <span className="badge">{STATUS_LABEL[row.original.status]}</span> },
  ]

  const actions: ReferenceCrudAction<Curriculum>[] = [
    {
      key: 'approve',
      labelRu: () => 'Утвердить',
      hidden: (row) => row.status !== 'draft',
      confirmTitleRu: (row) => `Утвердить план «${row.name}»?`,
      confirmBodyRu: () => 'Дальнейшая правка строк будет создавать новые версии, а не менять их на месте.',
      successRu: () => 'План утверждён',
      run: (row) => api.invoke('curricula:approve', { id: row.id, rowVersion: row.rowVersion }),
    },
    {
      key: 'archive',
      labelRu: (row) => (row.status === 'archived' ? ruCommon.restore : ruCommon.archive),
      confirmTitleRu: (row) => (row.status === 'archived' ? 'Вернуть план из архива в черновики?' : 'Архивировать план?'),
      successRu: (row) => (row.status === 'archived' ? ruCommon.restoredOk : ruCommon.archivedOk),
      run: (row) => api.invoke('curricula:archive', { id: row.id, rowVersion: row.rowVersion, archived: row.status !== 'archived' }),
    },
    {
      key: 'delete',
      labelRu: () => ruCommon.delete,
      variant: 'danger',
      confirmTitleRu: (row) => `Удалить план «${row.name}»?`,
      confirmBodyRu: () =>
        'Вместе с планом удалятся все его строки и их недельная раскладка. План, по строкам которого уже роздана нагрузка, удалить нельзя. ' +
        'Удаление можно отменить на экране «Операции».',
      confirmLabelRu: ruCommon.yesDelete,
      successRu: () => ruCommon.deletedOk,
      run: async (row) => {
        const res = await api.invoke('curricula:delete', { id: row.id })
        return res.ok ? { ok: true as const, value: { ok: true as const } } : res
      },
    },
  ]

  return (
    <>
      <ReferenceCrudPage<Curriculum, CurriculumFormValues>
        key={refreshKey}
        entityName="curriculum"
        titleRu="Учебные планы"
        createTitleRu="Новый учебный план"
        editTitleRu="Учебный план"
        columns={columns}
        resolver={zodResolver(curriculumSaveInput)}
        defaultValues={defaultValues}
        toFormValues={(row) => ({ specialityId: row.specialityId, admissionYear: row.admissionYear, name: row.name })}
        renderFields={(control) => (
          <>
            <SelectField
              control={control}
              name="specialityId"
              label="Специальность"
              valueType="number"
              options={specialities.map((s) => ({ value: String(s.id), label: s.name }))}
            />
            <NumberField control={control} name="admissionYear" label="Год набора" min={2000} max={2100} />
            <TextField control={control} name="name" label="Название плана" />
          </>
        )}
        list={(includeArchived) => api.invoke('curricula:list', { includeArchived })}
        save={(values) => api.invoke('curricula:save', values)}
        actions={actions}
        hasArchivedFilter
        archivedFilterLabelRu="Показывать архивные"
        rowClassName={(row) => (row.status === 'archived' ? 'archived-row' : '')}
        renderExtra={(row) => (
          <div className="btn-group" style={{ marginTop: 12 }}>
            <button type="button" className="btn" onClick={() => navigate(`/curricula/${row.id}`)}>
              Открыть строки плана →
            </button>
            <button type="button" className="btn" onClick={() => setCopySource(row)}>
              Копировать на новый набор
            </button>
          </div>
        )}
      />

      {copySource && (
        <CopyCurriculumDialog
          source={copySource}
          specialities={specialities}
          onClose={() => setCopySource(null)}
          onCopied={(operationId) => {
            notifySuccess(`План скопирован (операция #${operationId}) — отменить можно в разделе «Операции»`)
            setCopySource(null)
            setRefreshKey((k) => k + 1)
          }}
          onError={(message) => notifyError(message)}
        />
      )}
    </>
  )
}
