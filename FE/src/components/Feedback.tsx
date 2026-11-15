import { AlertCircle, Inbox, LoaderCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function LoadingState({ label = 'Memuat data…' }: { label?: string }) {
  return <div role="status" className="flex min-h-48 items-center justify-center gap-3 text-sm text-[#526578]"><LoaderCircle className="size-5 animate-spin" />{label}</div>
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex min-h-48 flex-col items-center justify-center gap-3 rounded-xl border border-[#F8B4B4] bg-[#FDE8E8] p-6 text-center">
      <AlertCircle className="size-6 text-[#C92A2A]" />
      <div><p className="font-semibold text-[#8B2020]">Data belum dapat ditampilkan</p><p className="mt-1 text-sm text-[#673333]">{message}</p></div>
      {onRetry && <Button type="button" variant="outline" onClick={onRetry}>Coba lagi</Button>}
    </div>
  )
}

export function EmptyState({ title, description, action }: { title: string; description: string; action?: React.ReactNode }) {
  return (
    <div className="flex min-h-56 flex-col items-center justify-center gap-3 p-8 text-center">
      <Inbox className="size-8 text-[#526578]" />
      <div><p className="font-semibold text-[#0C2A46]">{title}</p><p className="mt-1 max-w-md text-sm text-[#526578]">{description}</p></div>
      {action}
    </div>
  )
}
