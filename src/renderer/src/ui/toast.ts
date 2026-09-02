import { toast, Toaster } from 'sonner'

export { Toaster }

export function notifySuccess(message: string): void {
  toast.success(message)
}

export function notifyError(message: string): void {
  toast.error(message)
}

export function notifyWarning(message: string): void {
  toast.warning(message)
}
