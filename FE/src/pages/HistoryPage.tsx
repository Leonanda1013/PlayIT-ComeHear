import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowUp, ArrowUpDown, AudioLines, Building2, CalendarDays, CheckCircle2, ChevronDown, Eye, Pause, Pencil, Play, Printer, Search, SlidersHorizontal, Volume2, X } from 'lucide-react'
import { Link, useNavigate, useParams } from 'react-router'
import type { SessionProps } from '@/App'
import { AppShell } from '@/components/AppShell'
import { PageTitle, PatientIdentity } from '@/components/ClinicalHeader'
import { EmptyState, ErrorState, LoadingState } from '@/components/Feedback'
import { SoapSummary } from '@/components/SoapSummary'
import { OfficialResumePrint } from '@/components/OfficialResumePrint'
import { EditPatientDialog } from '@/components/EditPatientDialog'
import { Badge, Panel } from '@/components/ui/kit'
import { getConsultation, getResume, getScribe, visitPath } from '@/lib/clinical'
import { dateShort, formatExportFileName, mmss, printResumeDocument, submissionMeta, timeWib } from '@/lib/format'
import { getHistory } from '@/lib/rm'
import type { HistoryVisit, Patient } from '@/lib/types'

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

function FilterSelect({
  icon: Icon,
  value,
  onChange,
  options,
  label,
}: {
  icon: React.ComponentType<{ className?: string }>
  value: string
  onChange: (v: string) => void
  options: readonly (readonly [string, string])[]
  label: string
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    if (open) {
      document.addEventListener('mousedown', handleClickOutside)
      document.addEventListener('keydown', handleKeyDown)
      return () => {
        document.removeEventListener('mousedown', handleClickOutside)
        document.removeEventListener('keydown', handleKeyDown)
      }
    }
  }, [open])

  const selected = options.find(([v]) => v === value)
  const displayLabel = selected ? selected[1] : options[0]?.[1] || label

  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className={`flex h-10 items-center gap-2 rounded-[10px] border border-[#d2e1e7] bg-white px-3 text-[13px] font-medium text-ch-ink shadow-sm transition hover:border-ch-brand ${
          open ? 'border-ch-brand ring-2 ring-ch-brand/15' : ''
        }`}
      >
        <Icon className="size-4 shrink-0 text-ch-brand" />
        <span className="truncate">{displayLabel}</span>
        <ChevronDown
          className={`size-3.5 shrink-0 text-[#6b7f93] transition-transform duration-150 ${
            open ? 'rotate-180 text-ch-brand' : ''
          }`}
        />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute left-0 top-[calc(100%+6px)] z-50 min-w-[200px] w-max max-w-[280px] rounded-[12px] border border-[#d3e2e8] bg-white p-1.5 shadow-lg"
        >
          <p className="px-2.5 py-1.5 text-[11px] font-semibold text-ch-muted">{label}</p>
          <div className="space-y-0.5">
            {options.map(([v, l]) => {
              const isSelected = v === value
              return (
                <button
                  key={v}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    onChange(v)
                    setOpen(false)
                  }}
                  className={`flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-[13px] transition hover:bg-[#eef6f8] ${
                    isSelected ? 'bg-[#e6f6f8] font-semibold text-ch-ink' : 'text-[#33475b]'
                  }`}
                >
                  <span className="truncate">{l}</span>
                  {isSelected && <CheckCircle2 className="ml-2 size-3.5 shrink-0 text-ch-teal" />}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
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

type SortField = 'date' | 'patient' | 'doctor' | 'diagnosis' | 'status'
type SortOrder = 'asc' | 'desc'

function SortHeader({
  label,
  field,
  currentField,
  currentOrder,
  onSort,
  className = '',
}: {
  label: string
  field: SortField
  currentField: SortField
  currentOrder: SortOrder
  onSort: (field: SortField) => void
  className?: string
}) {
  const isActive = currentField === field
  return (
    <button
      type="button"
      onClick={() => onSort(field)}
      className={`group flex items-center gap-1.5 text-left font-semibold select-none transition hover:text-ch-brand ${
        isActive ? 'text-ch-brand font-bold' : 'text-[#3f5468]'
      } ${className}`}
      title={`Urutkan ${label} (${isActive && currentOrder === 'asc' ? 'Z - A' : 'A - Z'})`}
    >
      <span>{label}</span>
      {isActive ? (
        <ArrowUp
          className={`size-3.5 shrink-0 transition-transform duration-200 ${
            currentOrder === 'asc' ? '' : 'rotate-180'
          }`}
        />
      ) : (
        <ArrowUpDown className="size-3 shrink-0 text-[#7f93a4]/50 transition group-hover:text-ch-brand group-hover:opacity-100" />
      )}
    </button>
  )
}

export function HistoryListPage({ user, onLogout, base }: SessionProps & { base: string }) {
  const [search, setSearch] = useState('')
  const q = useDeferredValue(search)
  const [filters, setFilters] = useState<Filters>({ range: '', poli: '', status: '' })
  const [sortField, setSortField] = useState<SortField>('date')
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc')
  const [editingPatient, setEditingPatient] = useState<Patient | null>(null)
  const history = useQuery({ queryKey: ['history', q], queryFn: () => getHistory(q) })
  const polis = useMemo(() => [...new Set((history.data?.visits || []).map((v) => v.location.poli || v.location.name).filter(Boolean))] as string[], [history.data])

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortField(field)
      setSortOrder(field === 'date' ? 'desc' : 'asc')
    }
  }

  const rows = useMemo(() => {
    const list = (history.data?.visits || [])
      .filter((v) => matchRange(v, filters.range) && (!filters.poli || (v.location.poli || v.location.name) === filters.poli) && matchStatus(v, filters.status))

    return list.slice().sort((a, b) => {
      let cmp = 0
      if (sortField === 'date') {
        const timeA = new Date(a.arrived_at || 0).getTime()
        const timeB = new Date(b.arrived_at || 0).getTime()
        cmp = timeA - timeB
      } else if (sortField === 'patient') {
        const nameA = (a.patient?.name || '').trim()
        const nameB = (b.patient?.name || '').trim()
        cmp = nameA.localeCompare(nameB, 'id', { sensitivity: 'base', numeric: true })
      } else if (sortField === 'doctor') {
        const docA = (a.doctor || '').trim()
        const docB = (b.doctor || '').trim()
        cmp = docA.localeCompare(docB, 'id', { sensitivity: 'base' })
      } else if (sortField === 'diagnosis') {
        const diagA = (a.diagnosis || '').trim()
        const diagB = (b.diagnosis || '').trim()
        if (!diagA && diagB) return 1
        if (diagA && !diagB) return -1
        cmp = diagA.localeCompare(diagB, 'id', { sensitivity: 'base' })
      } else if (sortField === 'status') {
        const statA = submissionMeta(a.submission_status, a.is_approved).label
        const statB = submissionMeta(b.submission_status, b.is_approved).label
        cmp = statA.localeCompare(statB, 'id', { sensitivity: 'base' })
      }

      if (cmp === 0) {
        return new Date(b.arrived_at || 0).getTime() - new Date(a.arrived_at || 0).getTime()
      }

      return sortOrder === 'asc' ? cmp : -cmp
    })
  }, [history.data, filters, sortField, sortOrder])

  return <AppShell user={user} onLogout={onLogout}>
    <PageTitle title="Riwayat Pasien" subtitle="Telusuri riwayat kunjungan seluruh pasien dan tinjau rekam medis dalam satu tempat." />
    <SearchFilters search={search} setSearch={setSearch} filters={filters} setFilters={setFilters} polis={polis} onReset={() => { setSearch(''); setFilters({ range: '', poli: '', status: '' }); setSortField('date'); setSortOrder('desc') }} />
    
    <section className="mt-4 rounded-[18px] border border-[#d3e2e8] bg-ch-panel p-4">
      <div className="overflow-x-auto">
        <div className="min-w-[860px]">
          <div className="grid grid-cols-[130px_1.3fr_1fr_1.2fr_170px_110px] items-center rounded-[12px] bg-[#e8f0f3] px-4 py-3.5 text-xs font-semibold text-[#3f5468]">
            <SortHeader label="Tanggal" field="date" currentField={sortField} currentOrder={sortOrder} onSort={handleSort} />
            <SortHeader label="Nama Pasien" field="patient" currentField={sortField} currentOrder={sortOrder} onSort={handleSort} />
            <SortHeader label="Nama Dokter" field="doctor" currentField={sortField} currentOrder={sortOrder} onSort={handleSort} />
            <SortHeader label="Diagnosa" field="diagnosis" currentField={sortField} currentOrder={sortOrder} onSort={handleSort} />
            <SortHeader label="Status" field="status" currentField={sortField} currentOrder={sortOrder} onSort={handleSort} />
            <span className="text-left font-semibold text-[#3f5468]">Aksi</span>
          </div>

          {history.isPending ? (
            <LoadingState label="Memuat riwayat…" />
          ) : history.isError ? (
            <div className="mt-4">
              <ErrorState message={history.error.message} onRetry={() => history.refetch()} />
            </div>
          ) : rows.length === 0 ? (
            <EmptyState
              title={search || filters.range || filters.poli || filters.status ? 'Tidak ada hasil untuk filter ini' : 'Belum ada riwayat kunjungan'}
              description={search || filters.status ? 'Ubah kata kunci atau tekan Reset untuk menampilkan semua riwayat.' : 'Kunjungan yang sudah diperiksa akan tercatat di sini.'}
            />
          ) : (
            <div className="divide-y divide-[#dde8ec]">
              {rows.map((v) => {
                const meta = submissionMeta(v.submission_status, v.is_approved)
                return (
                  <div key={v.id} className="grid min-h-[63px] grid-cols-[130px_1.3fr_1fr_1.2fr_170px_110px] items-center px-4 py-2.5 text-[13px]">
                    <div>
                      <p className="font-bold">{dateShort(v.arrived_at)}</p>
                      <p className="text-[11px] text-ch-muted">{timeWib(v.arrived_at)}</p>
                    </div>
                    <div className="min-w-0 pr-3">
                      <p className="truncate font-semibold">{v.patient.name}</p>
                      <p className="text-[11px] text-ch-muted">RM {v.patient.rm_number}</p>
                    </div>
                    <div className="min-w-0 pr-3">
                      <p className="truncate">{v.doctor || '—'}</p>
                      <p className="text-[11px] text-ch-muted">{v.location.poli || v.location.name}</p>
                    </div>
                    <p className="pr-3">{v.diagnosis || <span className="text-ch-faint">Belum ditetapkan</span>}</p>
                    <span>
                      <Badge tone={meta.tone === 'info' ? 'info' : meta.tone} icon={meta.tone === 'ok' ? <CheckCircle2 className="size-3" /> : undefined}>
                        {meta.label}
                      </Badge>
                    </span>
                    <div className="flex items-center gap-1.5">
                      <Link
                        to={`${base}/${v.id}`}
                        title="Lihat Detail Rekam Medis"
                        className="grid size-8 place-items-center rounded-[8px] border border-[#cbe3e9] bg-[#f0f9fa] text-ch-teal transition hover:border-ch-brand hover:bg-[#e1f3f6] hover:shadow-sm"
                      >
                        <Eye className="size-4" />
                        <span className="sr-only">Lihat Detail</span>
                      </Link>
                      <button
                        type="button"
                        title="Edit Data Pasien"
                        onClick={() => setEditingPatient(v.patient)}
                        className="grid size-8 place-items-center rounded-[8px] border border-[#f3dfa6] bg-[#fdfaf1] text-[#b88018] transition hover:border-[#dfa120] hover:bg-[#fbf2da] hover:shadow-sm"
                      >
                        <Pencil className="size-3.5" />
                        <span className="sr-only">Edit Pasien</span>
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
      {!!rows.length && <p className="mt-3 px-1 text-xs text-ch-muted">Menampilkan {rows.length} dari {history.data?.count ?? rows.length} kunjungan</p>}
    </section>

    <EditPatientDialog
      patient={editingPatient}
      open={!!editingPatient}
      onClose={() => setEditingPatient(null)}
      onSuccess={() => {
        history.refetch()
      }}
    />
  </AppShell>
}

export function HistoryDetailPage({ user, onLogout, base }: SessionProps & { base: string }) {
  const { visitId } = useParams()
  const id = Number(visitId)
  const navigate = useNavigate()
  const [filters, setFilters] = useState<Filters>({ range: '', poli: '', status: '' })
  const [editingPatient, setEditingPatient] = useState<Patient | null>(null)
  const consultation = useQuery({ queryKey: ['consultation', id], queryFn: () => getConsultation(id), enabled: id > 0 })
  const patient = consultation.data?.visit.patient

  useEffect(() => {
    if (consultation.data) {
      const v = consultation.data.visit
      const p = v.patient
      document.title = formatExportFileName({
        rmNumber: p.rm_number,
        visitDate: v.arrived_at || v.called_at || v.started_at,
        visitCode: v.code,
        docType: 'ResumeMedis',
      })
      return () => {
        document.title = 'ComeHear'
      }
    }
  }, [consultation.data])

  return <AppShell user={user} onLogout={onLogout} title={consultation.data ? `${consultation.data.visit.location.poli || 'Poli'} / ${consultation.data.visit.location.name}` : undefined}>
    <div className="print:hidden">
      <PageTitle title="Riwayat Pasien" back={base} />
      {patient && <SearchFilters search={`${patient.name} / ${patient.rm_number}`} setSearch={() => navigate(base)} filters={filters} setFilters={setFilters} polis={[]} onReset={() => navigate(base)} onClear={() => navigate(base)} />}
    </div>
    <div className="mt-4 space-y-4 print:mt-0 print:space-y-0">
      {consultation.isPending ? <LoadingState label="Memuat rekam medis…" /> : consultation.isError ? <ErrorState message={consultation.error.message} onRetry={() => consultation.refetch()} /> : <>
        <div className="print:hidden">
          <PatientIdentity
            patient={consultation.data.visit.patient}
            onEdit={user.role !== 'dokter' ? (p) => setEditingPatient(p) : undefined}
          />
        </div>
        <RecordSummary id={id} />
      </>}
    </div>
    <EditPatientDialog
      patient={editingPatient}
      open={!!editingPatient}
      onClose={() => setEditingPatient(null)}
    />
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

  const handlePrint = () => {
    printResumeDocument({
      rmNumber: data.visit.patient.rm_number,
      visitDate: data.visit.arrived_at || data.visit.called_at || data.visit.started_at,
      visitCode: data.visit.code,
      docType: 'ResumeMedis',
    })
  }

  return <>
    <Panel className="print:hidden">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h2 className="text-[20px] font-bold">Ringkasan Rekam Medis</h2><p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-ch-muted">{data.visit.code} · {snapshot?.approved_at ? `Divalidasi ${dateShort(snapshot.approved_at)} ${timeWib(snapshot.approved_at)}` : 'Belum divalidasi dokter'} <Badge tone={meta.tone === 'info' ? 'info' : meta.tone}>{meta.label}</Badge></p></div>
        <button type="button" onClick={handlePrint} className="inline-flex h-9 items-center gap-2 rounded-[10px] border border-[#d2e1e7] bg-white px-3 text-[13px] font-semibold hover:border-ch-brand print:hidden"><Printer className="size-4 text-ch-teal" /> Cetak Resume</button>
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
    <div className="hidden print:block">
      <OfficialResumePrint consultation={data} resume={resume.data} />
    </div>
  </>
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
