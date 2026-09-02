import { createHashRouter, Navigate } from 'react-router-dom'
import { BuildingsPage } from '../features/buildings/BuildingsPage'
import { AcademicYearsPage } from '../features/calendar/AcademicYearsPage'
import { CalendarPeriodsPage } from '../features/calendar/CalendarPeriodsPage'
import { CalendarYearPage } from '../features/calendar/CalendarYearPage'
import { SemestersPage } from '../features/calendar/SemestersPage'
import { CmcPage } from '../features/cmc/CmcPage'
import { DisciplinesPage } from '../features/disciplines/DisciplinesPage'
import { GroupsPage } from '../features/groups/GroupsPage'
import { OperationsPage } from '../features/operations/OperationsPage'
import { PairGridPage } from '../features/settings/PairGridPage'
import { RoomsPage } from '../features/rooms/RoomsPage'
import { SpecialitiesPage } from '../features/specialities/SpecialitiesPage'
import { SystemPage } from '../features/system/SystemPage'
import { TeachersPage } from '../features/teachers/TeachersPage'
import { AppShell } from './AppShell'

// createHashRouter, а не BrowserRouter: собранный renderer грузится по file://,
// обычная история браузера там не работает без сервера.
export const router = createHashRouter([
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: <Navigate to="/specialities" replace /> },
      { path: 'specialities', element: <SpecialitiesPage /> },
      { path: 'cmc', element: <CmcPage /> },
      { path: 'buildings', element: <BuildingsPage /> },
      { path: 'rooms', element: <RoomsPage /> },
      { path: 'disciplines', element: <DisciplinesPage /> },
      { path: 'teachers', element: <TeachersPage /> },
      { path: 'groups', element: <GroupsPage /> },
      { path: 'academic-years', element: <AcademicYearsPage /> },
      { path: 'semesters', element: <SemestersPage /> },
      { path: 'calendar-periods', element: <CalendarPeriodsPage /> },
      { path: 'calendar-year', element: <CalendarYearPage /> },
      { path: 'system', element: <SystemPage /> },
      { path: 'operations', element: <OperationsPage /> },
      { path: 'pair-grid', element: <PairGridPage /> },
    ],
  },
])
