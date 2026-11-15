import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowUp, AudioLines, Building2, CalendarDays, CheckCircle2, ChevronDown, ChevronRight, Pause, Play, Printer, Search, SlidersHorizontal, Volume2, X } from 'lucide-react'
import { Link, useNavigate, useParams } from 'react-router'
import type { SessionProps } from '@/App'
import { AppShell } from '@/components/AppShell'
import { PageTitle, PatientIdentity } from '@/components/ClinicalHeader'
import { EmptyState, ErrorState, LoadingState } from '@/components/Feedback'
import { SoapSummary } from '@/components/SoapSummary'
import { Badge, Panel } from '@/components/ui/kit'
import { getConsultation, getResume, getScribe, visitPath } from '@/lib/clinical'
import { dateShort, mmss, submissionMeta, timeWib } from '@/lib/format'
import { getHistory } from '@/lib/rm'
import type { HistoryVisit } from '@/lib/types'

type Filters = { range: string; poli: string; status: string }
const RANGES = [['', 'Semua tanggal'], ['today', 'Hari ini'], ['7', '7 hari terakhir'], ['30', '30 hari terakhir']] as const
const STATUSES = [['', 'Semua status'], ['SENT', 'SATUSEHAT Terkirim'], ['PROSES', 'Dalam Proses'], ['NEEDS_ATTENTION', 'Gagal Terkirim'], ['DRAFT', 'Belum divalidasi']] as const

function matchStatus(v: HistoryVisit, status: string) {
  if (!status) return true
  if (status === 'DRAFT') return !v.is_approved
  if (status === 'PROSES') return v.is_approved && ['QUEUED', 'SENDING', 'RETRY_WAIT', 'RECONCILING'].includes(v.submission_status || '')
  return v.submission_status === status
}
function matchRange(v: HistoryVisit, range: string) {
  if (!range || !v.arrived_at) return true
  const days = range === 'today' ? 0 : Number(range)
  const start = new Date(); start.setHours(0, 0, 0, 0); start.setDate(start.getDate() - days)
  return new Date(v.arrived_at) >= start
}

function FilterSelect({ icon: Icon, value, onChange, options, label }: { icon: React.ComponentType<{ className?: string }>; value: string; onChange: (v: string) => void; options: readonly (readonly [string, string])[]; label: string }) {
  return <label className="relative inline-flex h-10 items-center gap-2 rounded-[10px] border border-[#d2e1e7] bg-white pl-3 pr-8 text-[13px] font-medium shadow-sm focus-within:border-ch-brand">
    <Icon className="size-4 text-ch-brand" /><span className="sr-only">{label}</span>
    <select value={value} onChange={(e) => onChange(e.target.value)} className="appearance-none bg-transparent outline-none">{options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
    <ChevronDown className="pointer-events-none absolute right-2.5 size-4 text-[#6b7f93]" />
  </label>
}

function SearchFilters({ search, setSearch, filters, setFilters, polis, onReset, onClear }: { search: string; setSearch: (v: string) => void; filters: Filters; setFilters: (f: Filters) => void; polis: string[]; onReset: () => void; onClear?: () => void }) {
  return <section className="flex flex-wrap items-center gap-3 rounded-[16px] border border-[#d3e2e8] bg-ch-panel p-3.5">
    <label className={`relative min-w-[260px] flex-1 ${onClear ? '' : ''}`}><Search className="absolute left-3.5 top-1/2 size-[17px] -translate-y-1/2 text-ch-brand" /><span className="sr-only">Cari nama pasien atau nomor RM</span><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Cari nama pasien atau nomor RM" className={`h-10 w-full rounded-[10px] border bg-white pl-10 pr-9 text-[13px] outline-none focus:border-ch-brand ${onClear ? 'border-ch-brand' : 'border-[#d2e1e7]'}`} />{(onClear || search) && <button type="button" aria-label="Hapus pencarian" onClick={onClear || (() => setSearch(''))} className="absolute right-2.5 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded-md text-[#6b7f93] hover:bg-[#eef4f7]"><X className="size-4" /></button>}</label>
    <FilterSelect icon={CalendarDays} label="Rentang tanggal" value={filters.range} onChange={(range) => setFilters({ ...filters, range })} options={RANGES} />
    <FilterSelect icon={Building2} label="Poli" value={filters.poli} onChange={(poli) => setFilters({ ...filters, poli })} options={[['', 'Semua poli'], ...polis.map((p) => [p, p] as const)]} />
    <FilterSelect icon={SlidersHorizontal} label="Status" value={filters.status} onChange={(status) => setFilters({ ...filters, status })} options={STATUSES} />
    <button type="button" onClick={onReset} className="px-1 text-[13px] font-semibold text-ch-brand hover:underline">Reset</button>
  </section>
}

export function HistoryListPage({ user, onLogout, base }: SessionProps & { base: string }) {
  const [search, setSearch] = useState('')
  const q = useDeferredValue(search)
  const [filters, setFilters] = useState<Filters>({ range: '', poli: '', status: '' })
  const [asc, setAsc] = useState(false)
  const history = useQuery({ queryKey: ['history', q], queryFn: () => getHistory(q) })
  const polis = useMemo(() => [...new Set((history.data?.visits || []).map((v) => v.location.poli || v.location.name).filter(Boolean))] as string[], [history.data])
  const rows = (history.data?.visits || [])
    .filter((v) => matchRange(v, filters.range) && (!filters.poli || (v.location.poli || v.location.name) === filters.poli) && matchStatus(v, filters.status))
    .sort((a, b) => (new Date(a.arrived_at || 0).getTime() - new Date(b.arrived_at || 0).getTime()) * (asc ? 1 : -1))

  return <AppShell user={user} onLogout={onLogout}>
    <PageTitle title="Riwayat Pasien" subtitle="Telusuri riwayat kunjungan seluruh pasien dan tinjau rekam medis dalam satu tempat." />
    <SearchFilters search={search} setSearch={setSearch} filters={filters} setFilters={setFilters} polis={polis} onReset={() => { setSearch(''); setFilters({ range: '', poli: '', status: '' }) }} />
    <section className="mt-4 rounded-[18px] border border-[#d3e2e8] bg-ch-panel p-4">
      <div className="overflow-x-auto"><div className="min-w-[860px]">
        <div className="grid grid-cols-[130px_1.3fr_1fr_1.2fr_170px_110px] items-center rounded-[12px] bg-[#e8f0f3] px-4 py-3.5 text-xs font-semibold text-[#3f5468]">
          <button type="button" onClick={() => setAsc(!asc)} className="flex items-center gap-1 text-left">Tanggal <ArrowUp className={`size-3.5 transition ${asc ? '' : 'rotate-180'}`} /></button><span>Nama Pasien</span><span>Nama Dokter</span><span>Diagnosa</span><span>Status</span><span>Aksi</span>
        </div>
        {history.isPending ? <LoadingState label="Memuat riwayat…" /> : history.isError ? <div className="mt-4"><ErrorState message={history.error.message} onRetry={() => history.refetch()} /></div> : rows.length === 0 ? <EmptyState title={search || filters.range || filters.poli || filters.status ? 'Tidak ada hasil untuk filter ini' : 'Belum ada riwayat kunjungan'} description={search || filters.status ? 'Ubah kata kunci atau tekan Reset untuk menampilkan semua riwayat.' : 'Kunjungan yang sudah diperiksa akan tercatat di sini.'} /> : <div className="divide-y divide-[#dde8ec]">
          {rows.map((v) => {
            const meta = submissionMeta(v.submission_status, v.is_approved)
            return <div key={v.id} className="grid min-h-[63px] grid-cols-[130px_1.3fr_1fr_1.2fr_170px_110px] items-center px-4 py-2.5 text-[13px]">
              <div><p className="font-bold">{dateShort(v.arrived_at)}</p><p className="text-[11px] text-ch-muted">{timeWib(v.arrived_at)}</p></div>
              <div className="min-w-0 pr-3"><p className="truncate font-semibold">{v.patient.name}</p><p className="text-[11px] text-ch-muted">RM {v.patient.rm_number}</p></div>
              <div className="min-w-0 pr-3"><p className="truncate">{v.doctor || '—'}</p><p className="text-[11px] text-ch-muted">{v.location.poli || v.location.name}</p></div>
              <p className="pr-3">{v.diagnosis || <span className="text-ch-faint">Belum ditetapkan</span>}</p>
              <span><Badge tone={meta.tone === 'info' ? 'info' : meta.tone} icon={meta.tone === 'ok' ? <CheckCircle2 className="size-3" /> : undefined}>{meta.label}</Badge></span>
              <Link to={`${base}/${v.id}`} className="inline-flex items-center gap-1 text-xs font-semibold text-ch-teal hover:underline">Lihat detail <ChevronRight className="size-3.5" /></Link>
            </div>
          })}
        </div>}
      </div></div>
      {!!rows.length && <p className="mt-3 px-1 text-xs text-ch-muted">Menampilkan {rows.length} dari {history.data?.count ?? rows.length} kunjungan</p>}
    </section>
  </AppShell>
}

export function HistoryDetailPage({ user, onLogout, base }: SessionProps & { base: string }) {
  const { visitId } = useParams()
  const id = Number(visitId)
  const navigate = useNavigate()
  const [filters, setFilters] = useState<Filters>({ range: '', poli: '', status: '' })
  const consultation = useQuery({ queryKey: ['consultation', id], queryFn: () => getConsultation(id), enabled: id > 0 })
  const patient = consultation.data?.visit.patient
  return <AppShell user={user} onLogout={onLogout} title={consultation.data ? `${consultation.data.visit.location.poli || 'Poli'} / ${consultation.data.visit.location.name}` : undefined}>
    <PageTitle title="Riwayat Pasien" back={base} />
    {patient && <SearchFilters search={`${patient.name} / ${patient.rm_number}`} setSearch={() => navigate(base)} filters={filters} setFilters={setFilters} polis={[]} onReset={() => navigate(base)} onClear={() => navigate(base)} />}
    <div className="mt-4 space-y-4">
      {consultation.isPending ? <LoadingState label="Memuat rekam medis…" /> : consultation.isError ? <ErrorState message={consultation.error.message} onRetry={() => consultation.refetch()} /> : <>
        <PatientIdentity patient={consultation.data.visit.patient} />
        <RecordSummary id={id} />
      </>}
    </div>
  </AppShell>
}

/** Panel "Ringkasan Rekam Medis" dengan tab SOAP dan Transkrip & Rekaman Audio. Dipakai di Riwayat dan Resume. */
export function RecordSummary({ id }: { id: number }) {
  const [tab, setTab] = useState<'soap' | 'audio'>('soap')
  const consultation = useQuery({ queryKey: ['consultation', id], queryFn: () => getConsultation(id) })
  const scribe = useQuery({ queryKey: ['scribe', id], queryFn: () => getScribe(id), enabled: !!consultation.data?.session })
  const resume = useQuery({ queryKey: ['resume', id], queryFn: () => getResume(id) })
  const data = consultation.data
  if (!data) return null
  const duration = scribe.data?.duration_s || 0
  const sub = resume.data?.submission
  const meta = submissionMeta(sub?.status, data.locked)
  const snapshot = data.note.approved_snapshot as { approved_at?: string } | null

  return <Panel className="print:border-0">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="text-[20px] font-bold">Ringkasan Rekam Medis</h2><p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-ch-muted">{data.visit.code} · {snapshot?.approved_at ? `Divalidasi ${dateShort(snapshot.approved_at)} ${timeWib(snapshot.approved_at)}` : 'Belum divalidasi dokter'} <Badge tone={meta.tone === 'info' ? 'info' : meta.tone}>{meta.label}</Badge></p></div>
      <button type="button" onClick={() => window.print()} className="inline-flex h-9 items-center gap-2 rounded-[10px] border border-[#d2e1e7] bg-white px-3 text-[13px] font-semibold hover:border-ch-brand print:hidden"><Printer className="size-4 text-ch-teal" /> Cetak Resume</button>
    </div>
    <div role="tablist" className="mt-4 flex gap-6 border-b border-[#dde8ec] px-2 print:hidden">
      {[['soap', 'Ringkasan SOAP'], ['audio', `Transkrip & Rekaman Audio${duration ? ` (${mmss(duration)})` : ''}`]].map(([key, label]) => <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key as 'soap' | 'audio')} className={`-mb-px border-b-2 pb-2 text-xs font-semibold ${tab === key ? 'border-ch-brand text-ch-teal' : 'border-transparent text-ch-muted hover:text-ch-ink'}`}>{label}</button>)}
    </div>
    <div className="mt-5">
      {tab === 'soap' ? <SoapSummary note={data.note} variant="compact" aiDraft={!!data.session} /> : <div className="space-y-4">
        <AudioPlayer src={data.session?.has_audio ? visitPath(id, `/audio/${data.session.id}`) : null} duration={duration} />
        <div>
          <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-bold">Transkrip Percakapan</h3><p className="text-[11px] text-ch-muted">Transkrip sesi · Pasien: {data.visit.patient.name}</p></div>
          {(scribe.data?.transcript || data.session?.transcript || []).length ? <div className="mt-3 divide-y divide-[#edf2f5]">
            {(scribe.data?.transcript || data.session?.transcript || []).map((seg, i) => <div key={i} className="grid grid-cols-[70px_1fr] gap-3 py-2.5 text-[13px]"><b className={seg.speaker === 'doctor' ? 'text-ch-teal' : 'text-ch-ink'}>{seg.speaker === 'doctor' ? 'Dokter' : seg.speaker === 'guardian' ? 'Pendamping' : 'Pasien'}</b><p className="leading-5">{seg.text}</p></div>)}
          </div> : <p className="mt-3 rounded-[10px] bg-[#f1f6f8] p-3 text-xs text-ch-muted">Kunjungan ini dicatat manual atau tidak memiliki transkrip.</p>}
        </div>
      </div>}
    </div>
  </Panel>
}

function AudioPlayer({ src, duration }: { src: string | null; duration: number }) {
  const ref = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState(0)
  const [rate, setRate] = useState(1)
  const [volume, setVolume] = useState(0.8)
  const [mediaDuration, setMediaDuration] = useState(0)
  useEffect(() => { if (ref.current) ref.current.playbackRate = rate }, [rate])
  useEffect(() => { if (ref.current) ref.current.volume = volume }, [volume])
  const total = mediaDuration || duration
  return <div className="rounded-[12px] border border-[#d6e3e9] bg-white p-4">
    <div className="flex items-center justify-between"><p className="flex items-center gap-2 text-sm font-bold"><AudioLines className="size-4 text-ch-brand" /> Rekaman konsultasi</p><span className="text-[11px] text-ch-muted">{!src ? 'Audio dihapus' : playing ? 'Diputar' : 'Dijeda'}</span></div>
    {src ? <>
      <audio ref={ref} src={src} preload="metadata" onLoadedMetadata={(e) => { const d = e.currentTarget.duration; if (Number.isFinite(d)) setMediaDuration(d) }} onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)} onEnded={() => setPlaying(false)} />
      <div className="mt-3 flex items-center gap-4">
        <button type="button" aria-label={playing ? 'Jeda rekaman' : 'Putar rekaman'} onClick={() => { const a = ref.current; if (!a) return; if (a.paused) { void a.play(); setPlaying(true) } else { a.pause(); setPlaying(false) } }} className="grid size-11 shrink-0 place-items-center rounded-full bg-ch-brand text-white hover:bg-ch-brand-hover">{playing ? <Pause className="size-5" /> : <Play className="size-5 fill-current" />}</button>
        <input type="range" aria-label="Posisi rekaman" min={0} max={total || 0} step={0.1} value={time} onChange={(e) => { if (ref.current) ref.current.currentTime = Number(e.target.value) }} className="h-1 flex-1 accent-ch-brand" />
        <span className="font-inter text-xs tabular-nums text-ch-teal">{mmss(time)} / {mmss(total)}</span>
      </div>
      <div className="mt-3 flex items-center justify-between"><p className="text-[11px] text-ch-muted">Penanda waktu mengikuti posisi rekaman.</p><div className="flex items-center gap-3"><button type="button" onClick={() => setRate(rate === 1 ? 1.5 : rate === 1.5 ? 2 : 1)} className="h-8 rounded-[8px] border border-[#d2e1e7] px-2.5 text-xs font-semibold" aria-label="Kecepatan putar">{rate}×</button><Volume2 className="size-4 text-ch-teal" /><input type="range" aria-label="Volume" min={0} max={1} step={0.05} value={volume} onChange={(e) => setVolume(Number(e.target.value))} className="w-20 accent-ch-brand" /></div></div>
    </> : <p className="mt-2 text-xs text-ch-muted">Audio dihapus otomatis setelah dokter memvalidasi SOAP (kebijakan privasi). Transkrip tetap tersimpan sebagai bagian rekam medis.</p>}
  </div>
}
