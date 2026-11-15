import { useDeferredValue, useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, BriefcaseMedical, Eye, Megaphone, MoreVertical, Search } from 'lucide-react'
import { Link } from 'react-router'
import { AppShell } from '@/components/AppShell'
import { EmptyState, ErrorState, LoadingState } from '@/components/Feedback'
import { Button } from '@/components/ui/button'
import { apiRequest, ApiError } from '@/lib/api'
import type { QueueResponse, User, Visit } from '@/lib/types'

const tabs = [
  { key: 'semua', label: 'Semua Pasien' }, { key: 'saat_ini', label: 'Saat Ini' },
  { key: 'selanjutnya', label: 'Selanjutnya' }, { key: 'menunggu', label: 'Menunggu' }, { key: 'selesai', label: 'Selesai' },
] as const

function statusMeta(visit: Visit) {
  if (visit.state === 'selesai') return ['Selesai', 'border-[#39b77d] bg-[#e8f8f0] text-[#13734d]']
  if (visit.state === 'saat_ini') return ['Antrean saat ini', 'border-[#1687ff] bg-[#e8f4ff] text-[#0874df]']
  if (visit.state === 'selanjutnya') return ['Pasien Selanjutnya', 'border-[#76d3df] bg-[#dcf6f9] text-[#087a8b]']
  return ['Menunggu', 'border-[#cbd8e3] bg-[#edf2f6] text-[#52677b]']
}

function StatusPill({ visit }: { visit: Visit }) {
  const [label, style] = statusMeta(visit)
  return <span className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold ${style}`}>{label}</span>
}

function patientMeta(visit: Visit) {
  const gender = visit.patient.gender_label?.toLowerCase().startsWith('l') ? 'L' : 'P'
  const birth = visit.patient.birth_date ? new Intl.DateTimeFormat('id-ID').format(new Date(`${visit.patient.birth_date}T00:00:00`)) : '—'
  return `No. RM ${visit.patient.rm_number} · ${gender} · ${birth}`
}

export function VisitsPage({ user, onLogout, onSessionExpired }: { user: User; onLogout: () => void; onSessionExpired: () => void }) {
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<(typeof tabs)[number]['key']>('semua')
  const [search, setSearch] = useState('')
  const deferredSearch = useDeferredValue(search)
  const [notice, setNotice] = useState('')
  const [actionError, setActionError] = useState('')
  const queue = useQuery({
    queryKey: ['queue', tab, deferredSearch],
    queryFn: () => apiRequest<QueueResponse>(`/api/backend/antrean?${new URLSearchParams({ tab, q: deferredSearch })}`),
    retry: (count, error) => !(error instanceof ApiError && error.status === 401) && count < 1,
  })
  const call = useMutation({
    mutationFn: (id: number) => apiRequest<{ message: string }>(`/api/backend/visits/${id}/panggil`, { method: 'POST' }),
    onSuccess: async (data) => { setActionError(''); setNotice(data.message); await queryClient.invalidateQueries({ queryKey: ['queue'] }) },
    onError: (error) => { setActionError(error.message); if (error instanceof ApiError && error.status === 401) onSessionExpired() },
  })
  const seed = useMutation({
    mutationFn: () => apiRequest<{ message: string }>('/api/backend/pendaftaran/demo', { method: 'POST' }),
    onSuccess: async (data) => { setNotice(data.message); await queryClient.invalidateQueries({ queryKey: ['queue'] }) },
  })
  const expired = queue.error instanceof ApiError && queue.error.status === 401
  useEffect(() => { if (expired) onSessionExpired() }, [expired, onSessionExpired])
  if (expired) return <LoadingState label="Sesi berakhir…" />

  const rawRows = queue.data?.rows || []
  const counts = queue.data?.counts || {}
  const rows = [...rawRows].sort((a, b) => {
    const qA = a.queue_no ?? (a as { queue_number?: number }).queue_number ?? 0
    const qB = b.queue_no ?? (b as { queue_number?: number }).queue_number ?? 0
    return qA !== qB ? qA - qB : a.id - b.id
  })
  const activeId = rows.find((row) => row.state === 'saat_ini')?.id

  return (
    <AppShell user={user} location={queue.data?.location?.label} onLogout={onLogout}>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-[28px] font-bold tracking-[-0.03em] text-[#102a43]">Daftar Antrean Pasien Hari Ini</h1>
        <span className="inline-flex h-10 items-center gap-2 rounded-xl border border-[#d2e1e7] bg-white px-3 text-xs font-semibold text-[#193149] shadow-sm"><BriefcaseMedical className="size-4 text-[#0ea5b7]" /> DPJP Aktif: {queue.data?.doctor?.name || user.name}</span>
      </div>
      {notice && <p role="status" className="mb-4 rounded-xl border border-[#a8dfc8] bg-[#eaf8f2] px-4 py-3 text-sm text-[#176e4e]">{notice}</p>}
      {actionError && <p role="alert" className="mb-4 rounded-xl border border-[#f2b8b8] bg-[#fff0f0] px-4 py-3 text-sm text-[#9d2525]">{actionError}</p>}

      <section className="min-h-[calc(100vh-175px)] overflow-hidden rounded-[20px] border border-[#d0e0e6] bg-[#fbfdfe] p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div role="tablist" aria-label="Filter antrean" className="flex max-w-full gap-1 overflow-x-auto rounded-xl border border-[#d4e3e9] bg-[#f8fbfc] p-0.5">
            {tabs.map((item) => <button key={item.key} type="button" role="tab" aria-selected={tab === item.key} onClick={() => setTab(item.key)} className={`flex min-h-8 shrink-0 items-center gap-1.5 rounded-lg px-4 text-[11px] font-semibold ${tab === item.key ? 'bg-[#14a2b5] text-white shadow-sm' : 'text-[#405465] hover:bg-[#e8f4f6]'}`}>{item.label}<span className={`rounded-full px-1.5 py-0.5 text-[10px] ${tab === item.key ? 'bg-[#087a8b] text-white' : 'bg-[#d1e2e7] text-[#395361]'}`}>{counts[item.key] ?? 0}</span></button>)}
          </div>
          <label className="relative block w-full sm:w-[360px]"><Search className="absolute left-3.5 top-1/2 size-[18px] -translate-y-1/2 text-[#0ea5b7]" /><span className="sr-only">Cari nama pasien atau nomor RM</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Cari nama pasien atau No. RM" className="h-11 w-full rounded-xl border border-[#d3e1e8] bg-[#fbfdfe] pl-10 pr-3 text-sm outline-none placeholder:text-[#8092a6] focus:border-[#0ea5b7] focus:ring-2 focus:ring-[#0ea5b7]/15" /></label>
        </div>

        <div className="mt-4 grid min-w-[800px] grid-cols-[52px_150px_minmax(280px,1fr)_170px_170px] items-center rounded-xl bg-[#eaf2f5] px-4 py-3 text-[11px] font-bold text-[#4f6578]"><span>No</span><span>Status</span><span>Nama Pasien</span><span>Draft SOAP</span><span className="text-center">Aksi</span></div>
        {queue.isPending ? <LoadingState label="Memuat antrean…" /> : queue.isError ? <ErrorState message={queue.error.message} onRetry={() => queue.refetch()} /> : rows.length === 0 ? <EmptyState title={search ? 'Pasien tidak ditemukan' : 'Belum ada kunjungan'} description={search ? 'Periksa nama atau nomor RM.' : 'Isi data simulasi untuk mencoba alur dokter.'} action={!search && tab === 'semua' ? <Button onClick={() => seed.mutate()}>Isi antrean demo</Button> : undefined} /> : (
          <div className="overflow-x-auto">
            <div className="min-w-[800px] divide-y divide-[#d7e5ea]">
              {rows.map((visit, index) => {
                const current = visit.state === 'saat_ini' || visit.id === activeId
                const canCall = visit.state === 'selanjutnya'
                const isDraftSaved = visit.state === 'selesai' || visit.has_note || visit.draft_status === 'Tersimpan' || visit.draft_status === 'Draf tersimpan'
                const prevWasCurrent = index > 0 && (rows[index - 1].state === 'saat_ini' || rows[index - 1].id === activeId)
                return <article key={visit.id} className={`relative grid grid-cols-[52px_150px_minmax(280px,1fr)_170px_170px] items-center px-4 py-4 text-sm ${current ? 'my-1 min-h-[112px] rounded-2xl !border-2 !border-[#0ea5b7] bg-white shadow-[0_4px_0_#b5e7ed] z-10' : `min-h-[66px] ${prevWasCurrent ? '!border-t-0' : ''}`}`}>
                  <span className="font-bold text-[#142a40]">{String(visit.queue_no ?? (visit as { queue_number?: number }).queue_number ?? 0).padStart(3, '0')}</span>
                  <StatusPill visit={visit} />
                  <div className="min-w-0 pr-4"><p className="truncate font-bold text-[#102a43]">{visit.patient.name}</p><p className="mt-0.5 truncate text-xs text-[#516575]">{patientMeta(visit)}</p></div>
                  <span className={`w-fit rounded-full border px-2.5 py-1 text-[11px] font-semibold ${isDraftSaved ? 'border-[#a7dfca] bg-[#e6f7ef] text-[#157153]' : 'border-[#cad9e3] bg-[#edf3f6] text-[#52697d]'}`}>{isDraftSaved ? 'Tersimpan' : 'Belum ada draf'}</span>
                  <div className="flex items-center justify-center gap-2">
                    {visit.state === 'selesai' ? (
                      <>
                        <Button asChild variant="outline" className="h-8 rounded-lg border-[#76d8e6] px-3 text-xs text-[#0791a5] hover:bg-[#eaf8f9]">
                          <Link to={`/kunjungan/${visit.id}/resume`}><Eye className="size-3.5" /> Lihat Resume</Link>
                        </Button>
                        <MoreVertical className="size-4 text-[#506473]" />
                      </>
                    ) : current ? (
                      <div className="grid gap-2">
                        <Button variant="outline" className="h-9 rounded-lg border-[#d2e1e7] px-5 text-xs font-semibold text-[#102a43] hover:bg-[#f0f7f9] flex items-center justify-center gap-1.5" onClick={() => call.mutate(visit.id)} disabled={call.isPending}>
                          Panggil <Megaphone className="size-4 text-[#0ea5b7]" />
                        </Button>
                        <Button asChild className="h-9 rounded-lg bg-[#14a2b5] px-5 text-xs font-semibold text-white hover:bg-[#0c8fa1] flex items-center justify-center gap-1.5">
                          <Link to={`/kunjungan/${visit.id}/subjektif`}>Isi SOAP <ArrowRight className="size-4" /></Link>
                        </Button>
                      </div>
                    ) : (
                      <Button variant="outline" className={`h-9 rounded-lg px-4 text-xs font-semibold ${canCall ? 'border-[#75d6e3] text-[#078fa3] hover:bg-[#e6f7fa]' : 'border-[#d8e2e7] text-[#b9cad5] bg-transparent opacity-60 cursor-not-allowed'}`} disabled={!canCall || call.isPending} onClick={() => call.mutate(visit.id)}>
                        Panggil
                      </Button>
                    )}
                  </div>
                </article>
              })}
            </div>
          </div>
        )}
      </section>
    </AppShell>
  )
}
