import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Eye, UserRoundPlus } from 'lucide-react'
import { Link } from 'react-router'
import type { SessionProps } from '@/App'
import { AppShell } from '@/components/AppShell'
import { PageTitle } from '@/components/ClinicalHeader'
import { EmptyState, ErrorState, LoadingState } from '@/components/Feedback'
import { useConfirmArrival, VisitDetailDialog } from '@/components/RmVisitDialogs'
import { Panel } from '@/components/ui/kit'
import { timeWib } from '@/lib/format'
import { getRmVisits, getSatusehat } from '@/lib/rm'
import type { RmVisit } from '@/lib/types'

const PROCESS = ['QUEUED', 'SENDING', 'RETRY_WAIT', 'RECONCILING']

function StatCard({ title, value, note, accent }: { title: string; value: number | string; note: string; accent: string }) {
  return <div className="relative overflow-hidden rounded-[14px] border border-[#d3e2e8] bg-ch-panel py-4 pl-5 pr-4"><span className="absolute inset-y-0 left-0 w-[4px]" style={{ background: accent }} /><p className="text-[14px] font-semibold text-[#33475b]">{title}</p><p className="mt-1 text-[24px] font-bold leading-8">{value}</p><p className="text-[11px] text-ch-muted">{note}</p></div>
}

function activities(rows: RmVisit[]) {
  const items: { at: string; title: string; sub: string }[] = []
  for (const v of rows) {
    if (v.arrived_at) items.push({ at: v.arrived_at, title: `Kunjungan ${v.patient.name} berhasil didaftarkan.`, sub: `RM ${v.patient.rm_number} · ${v.visit_type === 'Baru' ? 'Pasien baru' : 'Kontrol'}` })
    if (v.confirmed_at) items.push({ at: v.confirmed_at, title: `Kedatangan ${v.patient.name} dikonfirmasi.`, sub: 'Status: Menunggu Pemeriksaan' })
    if (v.rm_status === 'selesai') items.push({ at: v.confirmed_at || v.arrived_at || '', title: `Pemeriksaan ${v.patient.name} selesai.`, sub: `Dokter: ${v.doctor || '—'}` })
  }
  return items.filter((i) => i.at).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 5)
}

export function RmDashboardPage({ user, onLogout }: SessionProps) {
  const visits = useQuery({ queryKey: ['rm-visits', 'hari_ini'], queryFn: () => getRmVisits({ scope: 'hari_ini' }), refetchInterval: 20_000 })
  const sync = useQuery({ queryKey: ['satusehat'], queryFn: getSatusehat, refetchInterval: 20_000 })
  const confirm = useConfirmArrival()
  const [detail, setDetail] = useState<RmVisit | null>(null)
  const rows = visits.data?.rows || []
  const pending = rows.filter((r) => r.rm_status === 'terjadwal')
  const subs = sync.data?.rows || []
  const sent = subs.filter((s) => s.status === 'SENT').length
  const proc = subs.filter((s) => PROCESS.includes(s.status)).length
  const failed = subs.filter((s) => s.status === 'NEEDS_ATTENTION').length

  return <AppShell user={user} onLogout={onLogout} title="Dashboard Petugas Rekam Medis">
    <PageTitle title="Dashboard Perekam Medis" subtitle="Selamat datang! Berikut ringkasan aktivitas pelayanan klinik hari ini."
      action={<Link to="/rm/kunjungan" className="inline-flex h-9 items-center gap-2 rounded-[10px] border border-[#d2e1e7] bg-white px-3 text-[13px] font-semibold shadow-sm hover:border-ch-brand"><UserRoundPlus className="size-4 text-ch-teal" /> Daftar Kunjungan</Link>} />

    <div className="grid gap-3 md:grid-cols-3">
      <StatCard title="Kunjungan Hari Ini" value={visits.data?.counts.total ?? '–'} note="Jadwal terdaftar hari ini" accent="#14a3b8" />
      <StatCard title="Belum Konfirmasi Kedatangan" value={visits.data?.counts.terjadwal ?? '–'} note="Pasien terjadwal belum dikonfirmasi" accent="#e9c46a" />
      <StatCard title="Sinkronisasi Gagal" value={sync.data ? failed : '–'} note="Rekam medis gagal SATUSEHAT" accent="#e5868b" />
    </div>

    <Panel className="mt-4">
      <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-[20px] font-bold">Perlu Tindakan</h2><p className="text-xs text-ch-muted">Kunjungan pasien yang memerlukan konfirmasi kedatangan.</p></div>
      <div className="mt-3 overflow-x-auto"><div className="min-w-[640px]">
        <div className="grid grid-cols-[1.4fr_1fr_1.4fr_140px] rounded-[8px] bg-[#e8f0f3] px-3 py-2.5 text-[11px] font-semibold text-[#3f5468]"><span>Pasien &amp; Nomor RM</span><span>Poli</span><span>Dokter</span><span className="text-right">Aksi</span></div>
        {visits.isPending ? <LoadingState /> : visits.isError ? <ErrorState message={visits.error.message} onRetry={() => visits.refetch()} /> : pending.length === 0 ? <EmptyState title="Tidak ada kedatangan yang perlu dikonfirmasi" description="Semua pasien terjadwal hari ini sudah dikonfirmasi." /> : <div className="divide-y divide-[#dde8ec]">
          {pending.slice(0, 5).map((v) => <div key={v.id} className="grid min-h-[50px] grid-cols-[1.4fr_1fr_1.4fr_140px] items-center px-3 py-2 text-[13px]">
            <div><p className="font-semibold">{v.patient.name}</p><p className="text-[11px] text-ch-muted">RM-{v.patient.rm_number}</p></div>
            <span className="font-semibold">{v.location.poli || v.location.name}</span>
            <span className="text-ch-muted">{v.doctor}</span>
            <div className="flex justify-end gap-2"><button type="button" onClick={() => confirm.open(v)} className="inline-flex h-8 items-center rounded-[8px] bg-ch-brand px-3.5 text-xs font-semibold text-white hover:bg-ch-brand-hover">Konfirmasi</button><button type="button" aria-label={`Detail kunjungan ${v.patient.name}`} onClick={() => setDetail(v)} className="grid size-8 place-items-center rounded-[8px] border border-[#d2e1e7] bg-white text-ch-teal hover:border-ch-brand"><Eye className="size-4" /></button></div>
          </div>)}
        </div>}
      </div></div>
      <div className="mt-3 flex items-center justify-between border-t border-[#e3ecf0] pt-3 text-xs"><p className="text-ch-muted">Menampilkan {Math.min(5, pending.length)} dari {pending.length} pasien terjadwal belum konfirmasi kedatangan</p><Link to="/rm/kunjungan" className="font-semibold text-ch-teal underline">Lihat Semua</Link></div>
    </Panel>

    <div className="mt-4 grid gap-4 lg:grid-cols-[1.55fr_1fr]">
      <Panel>
        <div className="flex items-center justify-between"><h2 className="text-[20px] font-bold">Aktivitas Terbaru</h2><p className="text-xs text-ch-muted">Diperbarui pukul {timeWib(visits.data?.updated_at)}</p></div>
        {activities(rows).length ? <ol className="mt-3 divide-y divide-[#e3ecf0]">{activities(rows).map((a, i) => <li key={i} className="grid grid-cols-[66px_1fr] gap-2 py-3"><span className="text-[13px] text-ch-muted">{timeWib(a.at).replace(' WIB', '')}</span><div><p className="text-[13px] font-semibold">{a.title}</p><p className="text-[11px] text-ch-muted">{a.sub}</p></div></li>)}</ol> : <p className="mt-3 text-sm text-ch-muted">Belum ada aktivitas hari ini.</p>}
      </Panel>
      <Panel className="flex flex-col">
        <h2 className="text-[20px] font-bold">Monitoring SATUSEHAT</h2>
        <dl className="mt-2 divide-y divide-[#e3ecf0]">{[['Berhasil Terkirim', sent, 'text-ch-ink'], ['Dalam Proses', proc, 'text-ch-ink'], ['Gagal Terkirim', failed, 'text-ch-bad']].map(([label, value, color]) => <div key={label as string} className="flex items-center justify-between py-3"><dt className="text-[13px] text-[#33475b]">{label}</dt><dd className={`text-[24px] font-bold ${color}`}>{sync.data ? value : '–'}</dd></div>)}</dl>
        <p className="mt-2 text-[11px] text-ch-muted">Sinkronisasi terakhir: {timeWib(sync.data?.updated_at)}{sync.data?.mode === 'mock' ? ' · mode simulasi' : ''}</p>
        <Link to="/rm/satusehat" className="mt-auto self-end pt-3 text-[13px] font-semibold text-ch-teal underline">Lihat Rekam Medis</Link>
      </Panel>
    </div>
    {confirm.dialog}
    <VisitDetailDialog visit={detail} onClose={() => setDetail(null)} onConfirm={confirm.open} />
  </AppShell>
}
