import { useDeferredValue, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Eye, Plus, RefreshCw, Search } from 'lucide-react'
import { Link } from 'react-router'
import type { SessionProps } from '@/App'
import { AppShell } from '@/components/AppShell'
import { PageTitle } from '@/components/ClinicalHeader'
import { EditPatientDialog } from '@/components/EditPatientDialog'
import { EmptyState, ErrorState, LoadingState } from '@/components/Feedback'
import { useConfirmArrival, VisitDetailDialog } from '@/components/RmVisitDialogs'
import { Badge, btn, inputClass, Panel, SelectInput } from '@/components/ui/kit'
import { dateShort, rmStatusMeta, timeWib, todayIso } from '@/lib/format'
import { getRmVisits } from '@/lib/rm'
import type { Patient, RmVisit } from '@/lib/types'

const SCOPES = [['hari_ini', 'Hari Ini'], ['mendatang', 'Mendatang'], ['riwayat', 'Riwayat']] as const
const PAGE = 8
const grid = 'grid grid-cols-[1.5fr_120px_110px_1.1fr_120px_1.3fr_120px] items-center'

function Stat({ title, value, note, accent }: { title: string; value: number | string; note: string; accent: string }) {
  return <div className="relative overflow-hidden rounded-[14px] border border-[#d3e2e8] bg-ch-panel py-3.5 pl-4 pr-3"><span className="absolute inset-y-0 left-0 w-[4px]" style={{ background: accent }} /><p className="text-[13px] font-semibold text-[#33475b]">{title}</p><p className="mt-1 flex items-baseline gap-2"><b className="text-[22px] leading-7">{value}</b><span className="text-[10px] text-ch-muted">{note}</span></p></div>
}

export function RmVisitsPage({ user, onLogout }: SessionProps) {
  const [scope, setScope] = useState<string>('hari_ini')
  const [search, setSearch] = useState('')
  const q = useDeferredValue(search)
  const [tanggal, setTanggal] = useState(todayIso())
  const [poli, setPoli] = useState('')
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(0)
  const [detail, setDetail] = useState<RmVisit | null>(null)
  const [editingPatient, setEditingPatient] = useState<Patient | null>(null)
  const confirm = useConfirmArrival()
  const visits = useQuery({ queryKey: ['rm-visits', scope, q, scope === 'hari_ini' ? tanggal : '', status], queryFn: () => getRmVisits({ scope, q, status, tanggal: scope === 'hari_ini' ? tanggal : '' }), refetchInterval: 20_000 })
  const polis = useMemo(() => [...new Set((visits.data?.rows || []).map((r) => r.location.poli || r.location.name))], [visits.data])
  const rows = (visits.data?.rows || []).filter((r) => !poli || (r.location.poli || r.location.name) === poli)
  const pages = Math.max(1, Math.ceil(rows.length / PAGE))
  const shown = rows.slice(page * PAGE, page * PAGE + PAGE)
  const c = visits.data?.counts
  const title = scope === 'hari_ini' ? (tanggal === todayIso() ? 'Daftar Kunjungan Hari Ini' : `Daftar Kunjungan ${dateShort(tanggal)}`) : scope === 'mendatang' ? 'Kunjungan Mendatang' : 'Riwayat Kunjungan'

  return <AppShell user={user} onLogout={onLogout}>
    <PageTitle title="Daftar Kunjungan" subtitle="Pantau jadwal kunjungan, kedatangan pasien, dan status pemeriksaan."
      action={<Link to="/rm/pendaftaran" className={btn.primary}><Plus className="size-4" /> Tambah Kunjungan</Link>} />

    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Stat title="Kunjungan Hari Ini" value={c?.total ?? '–'} note="Jadwal terdaftar" accent="#7fd3df" />
      <Stat title="Belum Konfirmasi Kedatangan" value={c?.terjadwal ?? '–'} note="Menunggu kedatangan pasien" accent="#e9c46a" />
      <Stat title="Menunggu Pemeriksaan" value={c?.menunggu_pemeriksaan ?? '–'} note="Kedatangan dikonfirmasi" accent="#8fbef5" />
      <Stat title="Selesai" value={c?.selesai ?? '–'} note="Kunjungan telah ditutup" accent="#8fdca3" />
    </div>

    <div role="tablist" className="mt-4 inline-flex rounded-[10px] border border-[#d6e3e9] bg-white p-[3px]">
      {SCOPES.map(([key, label]) => <button key={key} type="button" role="tab" aria-selected={scope === key} onClick={() => { setScope(key); setPage(0) }} className={`h-8 rounded-[8px] px-4 text-[12px] font-semibold ${scope === key ? 'bg-ch-brand text-white' : 'text-[#33475b] hover:bg-[#eaf5f7]'}`}>{label}</button>)}
    </div>

    <div className="mt-3 grid gap-3 md:grid-cols-[1.3fr_.9fr_.9fr_1.2fr]">
      <label className="relative"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ch-brand" /><span className="sr-only">Cari pasien</span><input value={search} onChange={(e) => { setSearch(e.target.value); setPage(0) }} placeholder="Cari nama pasien atau nomor RM" className={`${inputClass} pl-9 text-[13px]`} /></label>
      <label><span className="sr-only">Tanggal</span><input type="date" value={tanggal} disabled={scope !== 'hari_ini'} onChange={(e) => { setTanggal(e.target.value || todayIso()); setPage(0) }} className={`${inputClass} text-[13px]`} /></label>
      <SelectInput aria-label="Poli" value={poli} onChange={(e) => { setPoli(e.target.value); setPage(0) }} className="text-[13px]"><option value="">Semua Poli</option>{polis.map((p) => <option key={p}>{p}</option>)}</SelectInput>
      <SelectInput aria-label="Status kunjungan" value={status} onChange={(e) => { setStatus(e.target.value); setPage(0) }} className="text-[13px]"><option value="">Semua Status</option>{Object.entries(rmStatusMeta).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}</SelectInput>
    </div>

    <Panel className="mt-4">
      <div className="flex items-center justify-between"><h2 className="text-[16px] font-bold">{title}</h2><button type="button" onClick={() => visits.refetch()} className="inline-flex items-center gap-1.5 text-[11px] text-ch-muted hover:text-ch-teal"><RefreshCw className={`size-3.5 ${visits.isFetching ? 'animate-spin' : ''}`} /> Diperbarui pukul {timeWib(visits.data?.updated_at).replace(' WIB', '')} WIB</button></div>
      <div className="mt-3 overflow-x-auto"><div className="min-w-[900px]">
        <div className={`${grid} rounded-[8px] bg-[#e8f0f3] px-3 py-2.5 text-[11px] font-semibold text-[#3f5468]`}><span>Pasien</span><span>Tanggal Kunjungan</span><span>Poli</span><span>Dokter</span><span>Jenis Kunjungan</span><span>Status Kunjungan</span><span className="text-right">Aksi</span></div>
        {visits.isPending ? <LoadingState /> : visits.isError ? <ErrorState message={visits.error.message} onRetry={() => visits.refetch()} /> : shown.length === 0 ? <EmptyState title={search || status || poli ? 'Tidak ada kunjungan yang cocok' : 'Belum ada kunjungan'} description={search || status || poli ? 'Ubah pencarian atau filter.' : 'Tambahkan kunjungan baru dari menu Pendaftaran.'} /> : <div className="divide-y divide-[#dde8ec]">
          {shown.map((v) => {
            const meta = rmStatusMeta[v.rm_status]
            return <div key={v.id} className={`${grid} min-h-[44px] px-3 py-1.5 text-[12px]`}>
              <div className="min-w-0"><p className="truncate text-[13px] font-semibold">{v.patient.name}</p><p className="text-[10px] text-ch-muted">RM-{v.patient.rm_number}</p></div>
              <span>{dateShort(v.visit_date)}</span>
              <span className="font-semibold">{(v.location.poli || v.location.name).replace('Poli Penyakit Dalam', 'Poli P. Dalam')}</span>
              <span className="truncate pr-2 text-ch-muted">{v.doctor}</span>
              <span className="text-ch-muted">{v.visit_type === 'Baru' ? 'Pasien Baru' : v.visit_type}</span>
              <span><Badge tone={meta.tone} className="text-[10px]">{meta.label}</Badge></span>
              <div className="flex justify-end gap-2">{v.rm_status === 'terjadwal' && scope !== 'riwayat' && <button type="button" onClick={() => confirm.open(v)} className="inline-flex h-7 items-center rounded-[7px] bg-ch-brand px-2.5 text-[11px] font-semibold text-white hover:bg-ch-brand-hover">Konfirmasi</button>}<button type="button" aria-label={`Detail kunjungan ${v.patient.name}`} onClick={() => setDetail(v)} className="grid size-7 place-items-center rounded-[7px] border border-[#d2e1e7] bg-white text-ch-teal hover:border-ch-brand"><Eye className="size-3.5" /></button></div>
            </div>
          })}
        </div>}
      </div></div>
      <div className="mt-3 flex items-center justify-between text-[11px] text-ch-muted">
        <p>Menampilkan {rows.length ? page * PAGE + 1 : 0}–{Math.min(rows.length, (page + 1) * PAGE)} dari {rows.length} kunjungan</p>
        <div className="flex items-center gap-2"><button type="button" disabled={page === 0} onClick={() => setPage(page - 1)} className="px-1 disabled:opacity-40">Sebelumnya</button>{Array.from({ length: pages }).map((_, i) => <button key={i} type="button" aria-current={i === page ? 'page' : undefined} onClick={() => setPage(i)} className={`grid size-6 place-items-center rounded-[6px] text-[11px] font-semibold ${i === page ? 'bg-ch-brand text-white' : 'hover:bg-[#eef4f7]'}`}>{i + 1}</button>)}<button type="button" disabled={page >= pages - 1} onClick={() => setPage(page + 1)} className="px-1 disabled:opacity-40">Selanjutnya</button></div>
      </div>
    </Panel>
    {confirm.dialog}
    <VisitDetailDialog
      visit={detail}
      onClose={() => setDetail(null)}
      onConfirm={confirm.open}
      onEditPatient={(p) => {
        setDetail(null)
        setEditingPatient(p)
      }}
    />
    <EditPatientDialog
      patient={editingPatient}
      open={!!editingPatient}
      onClose={() => setEditingPatient(null)}
    />
  </AppShell>
}
