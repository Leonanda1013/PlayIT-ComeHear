import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, Clock3, RefreshCw, TriangleAlert } from 'lucide-react'
import { AppShell } from '@/components/AppShell'
import { PageTitle, PatientIdentity } from '@/components/ClinicalHeader'
import { ErrorState, LoadingState } from '@/components/Feedback'
import { btn, Notice } from '@/components/ui/kit'
import { formatWib, getResume } from '@/lib/clinical'
import { requeueSubmission } from '@/lib/rm'
import type { User } from '@/lib/types'
import { RecordSummary } from '@/pages/HistoryPage'

const statusText: Record<string, string> = { QUEUED: 'Antre kirim', SENDING: 'Sedang dikirim', RETRY_WAIT: 'Menunggu percobaan ulang', RECONCILING: 'Memeriksa hasil kirim', NEEDS_ATTENTION: 'Perlu tindak lanjut', SENT: 'Berhasil terkirim' }
const ACTIVE = ['QUEUED', 'SENDING', 'RETRY_WAIT', 'RECONCILING']

export function ResumePage({ id, user, onLogout }: { id: number; user: User; onLogout: () => void }) {
  const queryClient = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const resume = useQuery({ queryKey: ['resume', id], queryFn: () => getResume(id), refetchInterval: (query) => ACTIVE.includes(query.state.data?.submission?.status || '') ? 3000 : false })

  async function retry() {
    const subId = resume.data?.submission?.id
    if (!subId) return
    setBusy(true); setError('')
    try { await requeueSubmission(subId); await queryClient.invalidateQueries({ queryKey: ['resume', id] }) }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Pengiriman belum dapat diulang.') }
    finally { setBusy(false) }
  }

  const data = resume.data
  const submission = data?.submission
  const sent = submission?.status === 'SENT'
  const attention = submission?.status === 'NEEDS_ATTENTION' || submission?.status === 'RETRY_WAIT'
  const snapshot = data?.note.approved_snapshot as { approved_at?: string; practitioner?: { name?: string } } | null | undefined

  return <AppShell user={user} onLogout={onLogout}>
    <PageTitle title="Resume Medis" back="/kunjungan" subtitle="Catatan final dokter dan status pengiriman kunjungan." />
    {resume.isPending ? <LoadingState label="Memuat resume…" /> : resume.isError ? <ErrorState message={resume.error.message} onRetry={() => resume.refetch()} /> : !data!.note.approved ? <ErrorState message="SOAP belum divalidasi dokter. Kembali ke tahap Validasi untuk menyelesaikannya." /> : <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-[16px] border border-[#b4e0ce] bg-ch-ok-soft p-4"><p className="flex items-center gap-2 text-[13px] font-semibold text-ch-ok"><CheckCircle2 className="size-4" /> Divalidasi dokter</p><p className="mt-1.5 text-sm">{snapshot?.practitioner?.name || user.name}</p><p className="text-xs text-ch-muted">{formatWib(snapshot?.approved_at)}</p></div>
        <div className="rounded-[16px] border border-[#d3e2e8] bg-ch-panel p-4"><p className="text-[13px] font-semibold">Catatan ComeHear</p><p className="mt-1.5 text-sm text-ch-ok">Tersimpan dan terkunci</p><p className="text-xs text-ch-muted">Audio rekaman dihapus setelah validasi.</p></div>
        <div className={`rounded-[16px] border p-4 ${sent ? 'border-[#b4e0ce] bg-ch-ok-soft' : attention ? 'border-[#f8b4b4] bg-ch-bad-soft' : 'border-[#a3dfea] bg-[#e6f6f8]'}`}><p className="flex items-center gap-2 text-[13px] font-semibold">{sent ? <CheckCircle2 className="size-4 text-ch-ok" /> : attention ? <TriangleAlert className="size-4 text-ch-bad" /> : <Clock3 className="size-4 text-ch-teal" />} {data!.mode === 'mock' ? 'SATUSEHAT (simulasi)' : 'SATUSEHAT sandbox'}</p><p className="mt-1.5 text-sm">{submission ? statusText[submission.status] || submission.status : 'Belum dikirim'}</p><p className="text-xs text-ch-muted">{submission ? `${submission.attempts} percobaan · ${submission.resources.length} resource FHIR` : 'Menunggu antrean kirim'}</p></div>
      </div>
      {error && <Notice tone="bad">{error}</Notice>}
      {submission?.last_error_text && <Notice tone="bad">Pengiriman memerlukan tindak lanjut: {submission.last_error_text}</Notice>}
      {attention && <button type="button" className={btn.outline} disabled={busy} onClick={retry}><RefreshCw className="size-4" /> Kirim Ulang</button>}
      <PatientIdentity patient={data!.visit.patient} />
      <RecordSummary id={id} />
    </div>}
  </AppShell>
}
