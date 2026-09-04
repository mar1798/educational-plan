import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'
import { ErrorBoundary } from './app/ErrorBoundary'
import { router } from './app/router'
import { Toaster } from './ui/toast'
import './styles/global.css'

const root = document.getElementById('root')
if (!root) throw new Error('#root не найден')

createRoot(root).render(
  <StrictMode>
    <Toaster richColors position="top-right" />
    <ErrorBoundary>
      <RouterProvider router={router} />
    </ErrorBoundary>
  </StrictMode>,
)
