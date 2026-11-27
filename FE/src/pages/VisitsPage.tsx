import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, BriefcaseMedical, Check, Eye, Megaphone, MoreVertical, Search, Square, X } from 'lucide-react'
import { Link } from 'react-router'
import type { SessionProps } from '@/App'
import { AppShell } from '@/components/AppShell'
import { ResumeModal } from '@/components/ResumeModal'
import { EmptyState, ErrorState, LoadingState } from '@/components/Feedback'
import { apiRequest, ApiError } from '@/lib/api'
import { dateId, genderShort } from '@/lib/format'
import { applyCall, QUEUE_KEY } from '@/lib/queue'
import type { QueueResponse, Visit } from '@/lib/types'

type TabKey = 'semua' | Visit['state']
type QueueAnnouncement = {
  visit: Visit
  controller: AbortController
  source?: AudioBufferSourceNode
}
const tabs: { key: TabKey; label: string }[] = [
  { key: 'semua', label: 'Semua Pasien' }, { key: 'saat_ini', label: 'Saat Ini' },
  { key: 'selanjutnya', label: 'Selanjutnya' }, { key: 'menunggu', label: 'Menunggu' }, { key: 'selesai', label: 'Selesai' },
]

// Kolom mengikuti frame 1440: No 52 · Status 148 · Nama (sisa) · Draft SOAP 200 · Aksi 170.
const grid = 'grid grid-cols-[52px_148px_minmax(260px,1fr)_200px_170px] items-center'

const statusPill: Record<Visit['state'], [string, string]> = {
  selesai: ['Selesai', 'border-[#3fb27f] bg-[#e7f6ee] text-[#137049]'],
  saat_ini: ['Antrean saat ini', 'border-[#2f8cff] bg-[#eaf3ff] text-[#0a66d1]'],
  selanjutnya: ['Pasien Selanjutnya', 'border-[#a5e1ea] bg-[#e4f6f9] text-[#0b7f91]'],
  menunggu: ['Menunggu', 'border-[#d3dde4] bg-[#eef2f5] text-[#5b6d7d]'],
}

export function VisitsPage({ user, onLogout, onSessionExpired }: SessionProps) {
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<TabKey>('semua')
  const [search, setSearch] = useState('')
  const [resumeId, setResumeId] = useState<number | null>(null)
  const [announcementError, setAnnouncementError] = useState('')
  const [callingId, setCallingId] = useState<number | null>(null)
  const audio = useRef<AudioContext | null>(null)
  const activeAnnouncement = useRef<QueueAnnouncement | null>(null)
  useEffect(() => () => {
    activeAnnouncement.current?.controller.abort()
    activeAnnouncement.current = null
    void audio.current?.close().catch(() => {})
    audio.current = null
  }, [])

  function finishAnnouncement(announcement: QueueAnnouncement) {
    if (activeAnnouncement.current !== announcement) return
    activeAnnouncement.current = null
    setCallingId(null)
  }
  // Satu kali ambil seluruh antrean hari ini; tab dan pencarian disaring di browser agar langsung pindah.
  const queue = useQuery({
    queryKey: QUEUE_KEY,
    queryFn: () => apiRequest<QueueResponse>('/api/backend/antrean'),
    retry: (count, error) => !(error instanceof ApiError && error.status === 401) && count < 1,
    refetchInterval: 20_000,
    staleTime: 10_000,
  })
  const call = useMutation({
    mutationFn: ({ visit }: QueueAnnouncement) => apiRequest(`/api/backend/visits/${visit.id}/panggil`, { method: 'POST' }),
    onMutate: async ({ visit }) => {
      await queryClient.cancelQueries({ queryKey: QUEUE_KEY })
      const previous = queryClient.getQueryData<QueueResponse>(QUEUE_KEY)
      if (previous) queryClient.setQueryData<QueueResponse>(QUEUE_KEY, { ...previous, rows: applyCall(previous.rows, visit.id) })
      return { previous }
    },
    onSuccess: async (_result, announcement) => {
      const { visit, controller } = announcement
      const { signal } = controller
      if (signal.aborted) return
      try {
        if (visit.queue_no === null) {
          setAnnouncementError('Pengumuman suara tidak diputar karena nomor antrean belum tersedia.')
          return
        }
        const context = audio.current
        if (!context) throw new Error('Audio context unavailable')
        const response = await fetch(`/api/backend/visits/${visit.id}/panggil/audio`, { credentials: 'same-origin', signal })
        if (response.status === 401) {
          onSessionExpired()
          return
        }
        if (!response.ok) throw new Error('Announcement audio unavailable')
        const buffer = await context.decodeAudioData(await response.arrayBuffer())
        if (signal.aborted) return
        if (context.state !== 'running') throw new Error('Audio context is not running')
        const source = context.createBufferSource()
        source.buffer = buffer
        source.connect(context.destination)
        source.onended = () => {
          source.disconnect()
          finishAnnouncement(announcement)
        }
        source.start()
        announcement.source = source
      } catch {
        if (!signal.aborted) setAnnouncementError('Pengumuman suara gagal diputar. Tekan Panggil untuk mencoba lagi.')
      } finally {
        if (!announcement.source) finishAnnouncement(announcement)
      }
    },
    onError: (error, announcement, context) => {
      finishAnnouncement(announcement)
      if (context?.previous) queryClient.setQueryData(QUEUE_KEY, context.previous)
      if (error instanceof ApiError && error.status === 401) onSessionExpired()
      else if (!announcement.controller.signal.aborted) setAnnouncementError('Pasien gagal dipanggil. Tekan Panggil untuk mencoba lagi.')
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: QUEUE_KEY }),
  })
  function callPatient(visit: Visit) {
    const active = activeAnnouncement.current
    if (active) {
      if (active.visit.id === visit.id) {
        finishAnnouncement(active)
        active.controller.abort()
        active.source?.stop()
      }
      return
    }
    if (call.isPending) return

    const announcement = { visit, controller: new AbortController() }
    activeAnnouncement.current = announcement
    setCallingId(visit.id)
    setAnnouncementError('')
    try {
      // Browser mengizinkan audio saat dipicu langsung oleh klik dokter.
      audio.current ??= new AudioContext()
      void audio.current.resume().catch(() => {})
    } catch {
      // Pemanggilan kunjungan tetap berjalan jika audio tidak tersedia.
    }
    call.mutate(announcement)
  }
  const expired = queue.error instanceof ApiError && queue.error.status === 401
  useEffect(() => { if (expired) onSessionExpired() }, [expired, onSessionExpired])

  const all = useMemo(() => [...(queue.data?.rows || [])].sort((a, b) => (a.queue_no ?? 0) - (b.queue_no ?? 0) || a.id - b.id), [queue.data])
  const counts = useMemo(() => {
    const c: Record<TabKey, number> = { semua: all.length, saat_ini: 0, selanjutnya: 0, menunggu: 0, selesai: 0 }
    all.forEach((v) => { c[v.state] += 1 })
    return c
  }, [all])
  const q = search.trim().toLowerCase()
  // Pasien yang sedang dipanggil tetap terlihat saat statusnya berpindah ke Saat Ini.
  const rows = all.filter((v) => v.id === callingId || ((tab === 'semua' || v.state === tab) && (!q || v.patient.name.toLowerCase().includes(q) || v.patient.rm_number.toLowerCase().includes(q))))

  return (
    <AppShell user={user} onLogout={onLogout}>
      <div className="flex flex-wrap items-center justify-between gap-4 pb-[22px]">
        <h1 className="text-[28px] font-bold leading-9 tracking-[-0.02em] text-ch-ink">Daftar Antrean Pasien Hari Ini</h1>
        <span className="inline-flex h-9 items-center gap-2 rounded-[10px] border border-[#d6e3e9] bg-white px-3 text-[14px] font-semibold text-ch-ink"><BriefcaseMedical className="size-4 text-ch-brand" /> DPJP Aktif: {queue.data?.doctor?.name || user.name}</span>
      </div>

      <section className="min-h-[calc(100vh-178px)] rounded-[20px] border border-[#d6e3e9] bg-[#f8fbfc] px-5 pb-5 pt-[19px]">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div role="tablist" aria-label="Filter antrean" className="flex max-w-full gap-0.5 overflow-x-auto rounded-[10px] border border-[#d6e3e9] bg-white p-[3px]">
            {tabs.map((item) => {
              const on = tab === item.key
              return <button key={item.key} type="button" role="tab" aria-selected={on} onClick={() => setTab(item.key)}
                className={`flex h-[29px] shrink-0 items-center gap-1.5 rounded-[7px] px-4 text-[13px] ${on ? 'bg-ch-brand font-semibold text-white' : 'font-medium text-[#33475b] hover:bg-[#eef6f8]'}`}>
                {item.label}
                <span className={`min-w-[17px] rounded-[4px] px-1 text-[11px] font-semibold leading-[15px] ${on ? 'bg-[#0b5f6b] text-white' : 'bg-[#dfe8ec] text-[#4b5f70]'}`}>{counts[item.key]}</span>
              </button>
            })}
          </div>
          <label className="relative block w-full sm:w-[360px]">
            <Search className="absolute left-4 top-1/2 size-[18px] -translate-y-1/2 text-ch-brand" />
            <span className="sr-only">Cari nama pasien atau nomor RM</span>
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Cari nama pasien atau No. RM" className="h-[41px] w-full rounded-[10px] border border-[#d6e3e9] bg-white pl-11 pr-3 text-[14px] text-ch-ink outline-none placeholder:text-[#7f91a3] focus:border-ch-brand focus:ring-2 focus:ring-ch-brand/15" />
          </label>
        </div>

        {announcementError && <p role="status" className="mt-3 text-sm text-red-700">{announcementError}</p>}
        <div className="mt-[17px] overflow-x-auto pb-1 lg:overflow-visible">
          <div className="min-w-[860px]">
            <div className={`${grid} h-[39px] rounded-[10px] bg-[#e8eff2] px-4 text-[12px] font-semibold text-[#3f5468]`}><span>No</span><span>Status</span><span>Nama Pasien</span><span>Draft SOAP</span><span className="text-center">Aksi</span></div>
            {queue.isPending ? <LoadingState label="Memuat antrean…" />
              : queue.isError ? <div className="mt-4"><ErrorState message={queue.error.message} onRetry={() => queue.refetch()} /></div>
              : rows.length === 0 ? <EmptyState title={q ? 'Pasien tidak ditemukan' : all.length ? 'Tidak ada pasien di tab ini' : 'Belum ada antrean hari ini'} description={q ? 'Periksa ejaan nama atau nomor RM.' : all.length ? 'Pilih tab lain untuk melihat pasien.' : 'Kunjungan yang dikonfirmasi petugas rekam medis akan muncul di sini.'} />
              : <div className="mt-4 border-b border-[#dfe8ec]">{rows.map((visit, i) => (
                <QueueRow key={visit.id} visit={visit} hideTopLine={i === 0 || rows[i - 1]?.state === 'saat_ini'}
                  isCalling={callingId === visit.id} callDisabled={callingId !== visit.id && (callingId !== null || call.isPending)}
                  onCall={() => callPatient(visit)} onResume={() => setResumeId(visit.id)} />
              ))}</div>}
          </div>
        </div>
      </section>
      {resumeId !== null && <ResumeModal visitId={resumeId} onClose={() => setResumeId(null)} />}
    </AppShell>
  )
}

function QueueRow({ visit, onCall, onResume, hideTopLine, isCalling, callDisabled }: {
  visit: Visit; onCall: () => void; onResume: () => void; hideTopLine: boolean; isCalling: boolean; callDisabled: boolean
}) {
  const current = visit.state === 'saat_ini'
  const [label, pill] = statusPill[visit.state]
  const saved = visit.is_approved || visit.state === 'selesai'
  const draft = saved ? ['Tersimpan', 'border-[#bfe5d2] bg-[#e7f6ee] text-[#137049]'] : visit.has_note ? ['Draf tersimpan', 'border-[#a5e1ea] bg-[#e4f6f9] text-[#0b7f91]'] : ['Belum ada draf', 'border-[#dbe3e8] bg-[#eef2f5] text-[#4b5f70]']
  const meta = `No. RM ${visit.patient.rm_number} · ${genderShort(visit.patient.gender_label)} · ${dateId(visit.patient.birth_date)}`
  const callStyle = isCalling ? 'border-red-700 bg-red-700 text-white hover:bg-red-800'
    : current ? 'border-[#d6e3e9] bg-white text-ch-ink hover:border-ch-brand hover:bg-[#eef8fa]'
      : visit.state === 'selanjutnya' ? 'border-[#5cc9d8] bg-white text-[#0b8597] hover:bg-[#e8f8fa]'
        : 'border-[#dfe7ec] bg-white text-[#b9c6d0] hover:border-[#5cc9d8] hover:text-[#0b8597]'
  const callButton = (
    <button type="button" onClick={onCall} disabled={callDisabled}
      aria-label={isCalling ? 'Hentikan panggilan suara' : undefined}
      className={`inline-flex items-center justify-center gap-2 rounded-[8px] border px-3 font-semibold transition-colors disabled:opacity-50 ${current ? 'h-[34px] min-w-[126px] text-[15px]' : 'h-9 text-[13px]'} ${callStyle}`}>
      {isCalling ? <>Hentikan <Square aria-hidden="true" className="size-4" /></>
        : <>Panggil {current && <Megaphone aria-hidden="true" className="size-4 text-ch-brand" />}</>}
    </button>
  )

  if (current) return (
    <article className={`${grid} relative z-10 my-[-1px] h-[113px] rounded-[12px] border-2 border-ch-brand bg-white px-[15px] shadow-[0_4px_0_#cdeef3]`}>
      <span className="text-[15px] font-bold text-ch-ink">{String(visit.queue_no ?? 0).padStart(3, '0')}</span>
      <span><span className={`inline-flex rounded-full border px-2.5 py-[2px] text-[13px] font-medium ${pill}`}>{label}</span></span>
      <div className="min-w-0 pl-1 pr-4"><p className="truncate text-[15px] font-semibold text-ch-ink">{visit.patient.name}</p><p className="truncate text-[13px] text-[#4b5f70]">{meta}</p></div>
      <span><span className={`inline-flex rounded-[5px] border px-2.5 py-[2px] text-[13px] font-medium ${draft[1]}`}>{draft[0]}</span></span>
      <div className="flex flex-col items-center gap-[10px]">
        {callButton}
        <Link to={`/kunjungan/${visit.id}/subjektif`} className="inline-flex h-9 w-[126px] items-center justify-center gap-2 rounded-[8px] bg-ch-brand text-[13px] font-bold text-white hover:bg-ch-brand-hover">Isi SOAP <ArrowRight className="size-4" /></Link>
      </div>
    </article>
  )

  return (
    <article className={`${grid} h-[66px] px-4 ${hideTopLine ? '' : 'border-t border-[#dfe8ec]'}`}>
      <span className="text-[15px] font-bold text-ch-ink">{String(visit.queue_no ?? 0).padStart(3, '0')}</span>
      <span><span className={`inline-flex rounded-full border px-2.5 py-[2px] text-[12px] font-medium ${pill}`}>{label}</span></span>
      <div className="min-w-0 pr-4"><p className="truncate text-[15px] font-semibold text-ch-ink">{visit.patient.name}</p><p className="truncate text-[13px] text-[#4b5f70]">{meta}</p></div>
      <span><span className={`inline-flex rounded-[5px] border px-2.5 py-[2px] text-[12px] font-medium ${draft[1]}`}>{draft[0]}</span></span>
      <div className="flex items-center justify-center gap-2">
        {/* Lihat Resume hanya untuk kunjungan berstatus Selesai. */}
        {visit.state === 'selesai' ? <>
          <button type="button" onClick={onResume} className="inline-flex h-[27px] items-center gap-1.5 rounded-[6px] border border-[#a5e1ea] bg-[#e4f6f9] px-3 text-[13px] font-medium text-[#0b8597] hover:bg-[#d3f0f4]"><Eye className="size-4" /> Lihat Resume</button>
          <MoreActions rmNumber={visit.patient.rm_number} />
        </> : callButton}
      </div>
    </article>
  )
}

/** Popover "Aksi lainnya" dari tombol titik tiga. Unduh & Cetak menunggu halaman resume; Salin No. RM sudah aktif. */
function MoreActions({ rmNumber }: { rmNumber: string }) {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => { if (!ref.current?.contains(event.target as Node)) setOpen(false) }
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { setOpen(false); trigger.current?.focus() } }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])

  async function copyRm() {
    try { await navigator.clipboard.writeText(rmNumber) } catch {
      const area = document.createElement('textarea'); area.value = rmNumber; document.body.appendChild(area); area.select(); document.execCommand('copy'); area.remove()
    }
    setCopied(true)
    setTimeout(() => { setCopied(false); setOpen(false) }, 900)
  }

  const item = 'flex h-10 w-full items-center px-[22px] text-left text-[14px] text-ch-ink'
  return <div ref={ref} className="relative">
    <button ref={trigger} type="button" aria-label="Aksi lainnya" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)} className={`grid size-6 place-items-center rounded-md text-[#4b5f70] hover:bg-[#eef4f7] ${open ? 'bg-[#eef4f7]' : ''}`}><MoreVertical className="size-4" /></button>
    {open && <div role="menu" aria-label="Aksi lainnya" className="absolute right-0 top-8 z-40 w-[232px] rounded-[10px] border border-[#dce6eb] bg-white pb-2 shadow-[0_6px_18px_rgba(8,29,45,0.12)]">
      <div className="mx-[10px] flex h-[46px] items-center justify-between border-b border-[#dce6eb] px-3">
        <p className="text-[14px] font-bold text-[#4a5f72]">Aksi lainnya</p>
        <button type="button" aria-label="Tutup" onClick={() => setOpen(false)} className="grid size-6 place-items-center rounded-md text-[#4a5f72] hover:bg-[#eef4f7]"><X className="size-4" /></button>
      </div>
      <div className="pt-1.5">
        {/* Tujuan Unduh/Cetak menyusul bersama halaman resume. */}
        <span role="menuitem" aria-disabled="true" className={`${item} cursor-default`}>Unduh Resume</span>
        <span role="menuitem" aria-disabled="true" className={`${item} cursor-default`}>Cetak Resume</span>
        <button type="button" role="menuitem" onClick={copyRm} className={`${item} hover:bg-[#f2f7f9]`}>{copied ? <span className="flex items-center gap-1.5 text-ch-teal"><Check className="size-4" /> No. RM disalin</span> : 'Salin No. RM'}</button>
      </div>
    </div>}
  </div>
}
