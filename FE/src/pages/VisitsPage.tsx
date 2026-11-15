import { useDeferredValue, useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, BriefcaseMedical, Eye, History, Megaphone, MoreVertical, Search } from 'lucide-react'
import { Link } from 'react-router'
import type { SessionProps } from '@/App'
import { AppShell } from '@/components/AppShell'
import { PageTitle } from '@/components/ClinicalHeader'
import { EmptyState, ErrorState, LoadingState } from '@/components/Feedback'
import { Badge, btn, Notice, type Tone } from '@/components/ui/kit'
import { apiRequest, ApiError } from '@/lib/api'
import { dateId, genderShort } from '@/lib/format'
import type { QueueResponse, Visit } from '@/lib/types'

const tabs = [
  { key: 'semua', label: 'Semua Pasien' }, { key: 'saat_ini', label: 'Saat Ini' },
  { key: 'selanjutnya', label: 'Selanjutnya' }, { key: 'menunggu', label: 'Menunggu' }, { key: 'selesai', label: 'Selesai' },
] as const

const stateMeta: Record<Visit['state'], [string, Tone]> = {
  selesai: ['Selesai', 'ok'],
  saat_ini: ['Antrean saat ini', 'blue'],
  selanjutnya: ['Pasien Selanjutnya', 'info'],
  menunggu: ['Menunggu', 'muted'],
}

const grid = 'grid grid-cols-[56px_150px_minmax(240px,1fr)_160px_190px] items-center'

export function VisitsPage({ user, onLogout, onSessionExpired }: SessionProps) {
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
    refetchInterval: 15_000,
  })
  const call = useMutation({
    mutationFn: (id: number) => apiRequest<{ message?: string }>(`/api/backend/visits/${id}/panggil`, { method: 'POST' }),
    onSuccess: async (data) => { setActionError(''); setNotice(data.message || 'Pasien dipanggil ke bilik.'); await queryClient.invalidateQueries({ queryKey: ['queue'] }) },
    onError: (error) => { setActionError(error.message); if (error instanceof ApiError && error.status === 401) onSessionExpired() },
  })
  const seed = useMutation({
    mutationFn: () => apiRequest<{ message: string }>('/api/backend/pendaftaran/demo', { method: 'POST' }),
    onSuccess: async (data) => { setNotice(data.message); await queryClient.invalidateQueries({ queryKey: ['queue'] }) },
  })
  const expired = queue.error instanceof ApiError && queue.error.status === 401
  useEffect(() => { if (expired) onSessionExpired() }, [expired, onSessionExpired])

  const rows = [...(queue.data?.rows || [])].sort((a, b) => (a.queue_no ?? 0) - (b.queue_no ?? 0) || a.id - b.id)
  const counts = queue.data?.counts || {}

  return (
    <AppShell user={user} onLogout={onLogout}>
      <PageTitle title="Daftar Antrean Pasien Hari Ini" back="history"
        action={<span className="inline-flex h-9 items-center gap-2 rounded-[10px] border border-[#d2e1e7] bg-white px-3 text-[13px] font-semibold text-ch-ink shadow-sm"><BriefcaseMedical className="size-4 text-ch-brand" /> DPJP Aktif: {queue.data?.doctor?.name || user.name}</span>} />
      <div className="space-y-3">
        {notice && <Notice>{notice}</Notice>}
        {actionError && <Notice tone="bad">{actionError}</Notice>}
      </div>

      <section className="mt-3 min-h-[calc(100vh-190px)] rounded-[18px] border border-[#d3e2e8] bg-ch-panel p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div role="tablist" aria-label="Filter antrean" className="flex max-w-full gap-0.5 overflow-x-auto rounded-[10px] border border-[#d6e3e9] bg-white p-[3px]">
            {tabs.map((item) => {
              const on = tab === item.key
              return <button key={item.key} type="button" role="tab" aria-selected={on} onClick={() => setTab(item.key)} className={`flex h-[30px] shrink-0 items-center gap-1.5 rounded-[8px] px-3.5 text-[11px] font-semibold ${on ? 'bg-ch-brand text-white' : 'text-[#33475b] hover:bg-[#eaf5f7]'}`}>{item.label}<span className={`min-w-[18px] rounded-[5px] px-1 text-[10px] ${on ? 'bg-[#0b6e7d] text-white' : 'bg-[#d6e5ea] text-[#33475b]'}`}>{counts[item.key] ?? 0}</span></button>
            })}
          </div>
          <label className="relative block w-full sm:w-[360px]"><Search className="absolute left-3.5 top-1/2 size-[17px] -translate-y-1/2 text-ch-brand" /><span className="sr-only">Cari nama pasien atau nomor RM</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Cari nama pasien atau No. RM" className="h-10 w-full rounded-[10px] border border-[#d6e3e9] bg-white pl-10 pr-3 text-[13px] outline-none placeholder:text-[#8092a6] focus:border-ch-brand focus:ring-2 focus:ring-ch-brand/15" /></label>
        </div>

        <div className="mt-4 overflow-x-auto">
          <div className="min-w-[800px]">
            <div className={`${grid} rounded-[10px] bg-[#e8f0f3] px-4 py-2.5 text-[11px] font-semibold text-[#3f5468]`}><span>No</span><span>Status</span><span>Nama Pasien</span><span className="text-center">Draft SOAP</span><span className="text-center">Aksi</span></div>
            {queue.isPending ? <LoadingState label="Memuat antrean…" /> : queue.isError ? <div className="mt-4"><ErrorState message={queue.error.message} onRetry={() => queue.refetch()} /></div> : rows.length === 0 ? <EmptyState title={search ? 'Pasien tidak ditemukan' : 'Belum ada antrean hari ini'} description={search ? 'Periksa ejaan nama atau nomor RM.' : 'Kunjungan yang dikonfirmasi petugas rekam medis akan muncul di sini.'} action={!search && tab === 'semua' ? <button type="button" className={btn.primary} onClick={() => seed.mutate()} disabled={seed.isPending}>Isi antrean demo</button> : undefined} /> : (
              <div className="mt-2 divide-y divide-[#dde8ec]">
                {rows.map((visit) => <QueueRow key={visit.id} visit={visit} calling={call.isPending} onCall={() => call.mutate(visit.id)} />)}
              </div>
            )}
          </div>
        </div>
      </section>
    </AppShell>
  )
}

function QueueRow({ visit, calling, onCall }: { visit: Visit; calling: boolean; onCall: () => void }) {
  const current = visit.state === 'saat_ini'
  const [label, tone] = stateMeta[visit.state] || stateMeta.menunggu
  const draft: [string, Tone] = visit.is_approved || visit.state === 'selesai' ? ['Tersimpan', 'ok'] : visit.has_note ? ['Draf tersimpan', 'info'] : ['Belum ada draf', 'muted']
  return (
    <article className={`${grid} px-4 text-[13px] ${current ? 'relative z-10 my-1.5 min-h-[88px] rounded-[14px] border-2 border-ch-brand !border-t-2 bg-white shadow-[0_3px_0_#b5e7ed]' : 'min-h-[64px]'}`}>
      <span className="font-bold text-ch-ink">{String(visit.queue_no ?? 0).padStart(3, '0')}</span>
      <span><Badge tone={tone}>{label}</Badge></span>
      <div className="min-w-0 pr-4"><p className="truncate font-bold text-ch-ink">{visit.patient.name}</p><p className="truncate text-xs text-[#516575]">No. RM {visit.patient.rm_number} · {genderShort(visit.patient.gender_label)} · {dateId(visit.patient.birth_date)}</p></div>
      <span className="flex justify-center"><Badge tone={draft[1]} className="rounded-[6px]">{draft[0]}</Badge></span>
      <div className="flex items-center justify-center gap-2">
        {visit.state === 'selesai' ? <>
          <Link to={`/kunjungan/${visit.id}/resume`} className={btn.ghostTeal}><Eye className="size-3.5" /> Lihat Resume</Link>
          <RowMenu visitId={visit.id} />
        </> : current ? (
          <div className="grid w-[112px] gap-1.5">
            <button type="button" onClick={onCall} disabled={calling} className="inline-flex h-8 items-center justify-center gap-1.5 rounded-[8px] border border-[#d2e1e7] bg-white text-xs font-semibold text-ch-ink hover:border-ch-brand">Panggil <Megaphone className="size-3.5 text-ch-brand" /></button>
            <Link to={`/kunjungan/${visit.id}/${visit.has_note ? 'draf-s' : 'subjektif'}`} className="inline-flex h-8 items-center justify-center gap-1.5 rounded-[8px] bg-ch-brand text-xs font-semibold text-white hover:bg-ch-brand-hover">Isi SOAP <ArrowRight className="size-3.5" /></Link>
          </div>
        ) : visit.state === 'selanjutnya' ? (
          <button type="button" onClick={onCall} disabled={calling} className="inline-flex h-8 items-center rounded-[8px] border border-[#75d6e3] bg-white px-4 text-xs font-semibold text-[#078fa3] hover:bg-[#e6f7fa]">Panggil</button>
        ) : (
          <button type="button" disabled title="Panggil pasien selanjutnya terlebih dahulu" className="inline-flex h-8 cursor-not-allowed items-center rounded-[8px] border border-[#dbe5ea] bg-white px-4 text-xs font-semibold text-[#b5c3cf]">Panggil</button>
        )}
      </div>
    </article>
  )
}

function RowMenu({ visitId }: { visitId: number }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent) => { if (!ref.current?.contains(event.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])
  return <div ref={ref} className="relative">
    <button type="button" aria-label="Aksi lain" aria-expanded={open} onClick={() => setOpen(!open)} className="grid size-7 place-items-center rounded-md text-[#506473] hover:bg-[#eef4f7]"><MoreVertical className="size-4" /></button>
    {open && <div className="absolute right-0 top-8 z-30 w-48 rounded-[10px] border border-[#d3e2e8] bg-white p-1 shadow-lg" role="menu">
      <Link role="menuitem" to={`/kunjungan/${visitId}/resume`} className="flex items-center gap-2 rounded-md px-2.5 py-2 text-xs hover:bg-[#eef6f8]"><Eye className="size-3.5" /> Lihat Resume</Link>
      <Link role="menuitem" to={`/riwayat/${visitId}`} className="flex items-center gap-2 rounded-md px-2.5 py-2 text-xs hover:bg-[#eef6f8]"><History className="size-3.5" /> Riwayat Pasien</Link>
    </div>}
  </div>
}
