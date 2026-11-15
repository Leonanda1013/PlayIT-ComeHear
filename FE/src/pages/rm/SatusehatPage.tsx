import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronRight, RefreshCw, Send } from 'lucide-react'
import { Link } from 'react-router'
import type { SessionProps } from '@/App'
import { AppShell } from '@/components/AppShell'
import { PageTitle } from '@/components/ClinicalHeader'
import { EmptyState, ErrorState, LoadingState } from '@/components/Feedback'
import { Badge, btn, Dialog, Notice, Panel, SelectInput } from '@/components/ui/kit'
import { dateShort, submissionMeta, timeWib } from '@/lib/format'
import { getSatusehat, requeueSubmission } from '@/lib/rm'
import type { SatusehatRow } from '@/lib/types'

const PROCESS = ['QUEUED', 'SENDING', 'RETRY_WAIT', 'RECONCILING']

/** Kategori kendala (DESIGN.md §4): menentukan tindakan berikutnya. */
function issue(row: SatusehatRow): { label: string; action: string; retry: boolean } {
  if (row.status === 'SENT') return { label: '—', action: 'Tidak perlu tindakan', retry: false }
  if (PROCESS.includes(row.status)) return { label: 'Sedang diproses', action: 'Tunggu proses selesai', retry: row.status === 'RETRY_WAIT' }
  const code = `${row.last_error_code || ''} ${row.last_error_text || ''}`.toLowerCase()
  if (/timeout|5\d\d|koneksi|connect|transport/.test(code)) return { label: 'Gangguan sementara', action: 'Kirim ulang', retry: true }
  if (/patient|pasien|ihs|nik|identitas/.test(code)) return { label: 'Data administratif', action: 'Perbaiki identitas pasien', retry: true }
  if (/condition|icd|diagnos|observation|klinis/.test(code)) return { label: 'Data klinis', action: 'Kembalikan ke dokter', retry: false }
  return { label: 'Masalah teknis', action: 'Teruskan ke tim integrasi', retry: true }
}

export function SatusehatPage({ user, onLogout }: SessionProps) {
  const queryClient = useQueryClient()
  const [status, setStatus] = useState('')
  const [target, setTarget] = useState<SatusehatRow | null>(null)
  const sync = useQuery({ queryKey: ['satusehat'], queryFn: getSatusehat, refetchInterval: 15_000 })
  const retry = useMutation({
    mutationFn: (id: number) => requeueSubmission(id),
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ['satusehat'] }) },
  })
  const all = sync.data?.rows || []
  const rows = all.filter((r) => !status || (status === 'PROSES' ? PROCESS.includes(r.status) : r.status === status))
  const count = (pred: (r: SatusehatRow) => boolean) => all.filter(pred).length

  return <AppShell user={user} onLogout={onLogout}>
    <PageTitle title="Integrasi SATUSEHAT" subtitle={`Pantau pengiriman rekam medis ke SATUSEHAT${sync.data?.mode === 'mock' ? ' (mode simulasi)' : ' (sandbox)'}.`}
      action={<button type="button" className={btn.outline} onClick={() => sync.refetch()} disabled={sync.isFetching}><RefreshCw className={`size-4 ${sync.isFetching ? 'animate-spin' : ''}`} /> Perbarui Status</button>} />
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {[['Seluruh pengiriman', all.length, '#7fd3df'], ['Berhasil Terkirim', count((r) => r.status === 'SENT'), '#8fdca3'], ['Dalam Proses', count((r) => PROCESS.includes(r.status)), '#8fbef5'], ['Gagal Terkirim', count((r) => r.status === 'NEEDS_ATTENTION'), '#e5868b']].map(([t, v, c]) => <div key={t as string} className="relative overflow-hidden rounded-[14px] border border-[#d3e2e8] bg-ch-panel py-3.5 pl-4 pr-3"><span className="absolute inset-y-0 left-0 w-[4px]" style={{ background: c as string }} /><p className="text-[13px] font-semibold text-[#33475b]">{t}</p><p className="text-[22px] font-bold">{sync.data ? v : '–'}</p></div>)}
    </div>
    <Panel className="mt-4">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-[16px] font-bold">Daftar Pengiriman</h2><p className="text-[11px] text-ch-muted">Diperbarui {timeWib(sync.data?.updated_at)} · menampilkan {rows.length} dari {all.length}</p></div><div className="w-56"><SelectInput aria-label="Filter status" value={status} onChange={(e) => setStatus(e.target.value)} className="text-[13px]"><option value="">Semua status</option><option value="SENT">Berhasil Terkirim</option><option value="PROSES">Dalam Proses</option><option value="NEEDS_ATTENTION">Gagal Terkirim</option></SelectInput></div></div>
      {retry.isSuccess && <div className="mt-3"><Notice>Pengiriman dimasukkan kembali ke antrean kirim.</Notice></div>}
      <div className="mt-3 overflow-x-auto"><div className="min-w-[900px]">
        <div className="grid grid-cols-[1.4fr_110px_1fr_160px_1.3fr_190px] rounded-[8px] bg-[#e8f0f3] px-3 py-2.5 text-[11px] font-semibold text-[#3f5468]"><span>Pasien</span><span>Tanggal</span><span>Dokter</span><span>Status</span><span>Kendala &amp; tindakan</span><span className="text-right">Aksi</span></div>
        {sync.isPending ? <LoadingState /> : sync.isError ? <ErrorState message={sync.error.message} onRetry={() => sync.refetch()} /> : rows.length === 0 ? <EmptyState title={all.length ? 'Tidak ada pengiriman dengan status ini' : 'Belum ada pengiriman'} description={all.length ? 'Pilih status lain.' : 'Rekam medis dikirim otomatis setelah dokter memvalidasi SOAP.'} /> : <div className="divide-y divide-[#dde8ec]">
          {rows.map((r) => {
            const meta = submissionMeta(r.status)
            const it = issue(r)
            return <div key={r.id} className="grid min-h-[52px] grid-cols-[1.4fr_110px_1fr_160px_1.3fr_190px] items-center px-3 py-2 text-[12px]">
              <div><p className="text-[13px] font-semibold">{r.patient?.name || '—'}</p><p className="text-[10px] text-ch-muted">RM-{r.patient?.rm_number} · {r.visit_code}</p></div>
              <span>{dateShort(r.visit_date)}</span>
              <span className="text-ch-muted">{r.doctor}</span>
              <span><Badge tone={meta.tone === 'info' ? 'info' : meta.tone}>{meta.label}</Badge></span>
              <div><p className="font-semibold">{it.label}</p><p className="text-[10px] text-ch-muted">{it.action}{r.attempts ? ` · ${r.attempts} percobaan` : ''}</p></div>
              <div className="flex justify-end gap-2">{it.retry && r.status !== 'SENT' && !PROCESS.includes(r.status) && <button type="button" onClick={() => setTarget(r)} className="inline-flex h-7 items-center gap-1 rounded-[7px] bg-ch-brand px-2.5 text-[11px] font-semibold text-white hover:bg-ch-brand-hover"><Send className="size-3" /> Kirim Ulang</button>}<Link to={`/rm/riwayat/${r.visit_id}`} className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-ch-teal hover:underline">Lihat detail <ChevronRight className="size-3.5" /></Link></div>
            </div>
          })}
        </div>}
      </div></div>
    </Panel>
    <Dialog open={!!target} onClose={() => { setTarget(null); retry.reset() }} title="Kirim ulang ke SATUSEHAT?">
      {target && <>
        <p className="text-sm text-ch-muted">Rekam medis <b className="text-ch-ink">{target.patient?.name}</b> ({target.visit_code}) akan dimasukkan kembali ke antrean kirim. Pengiriman ganda dicegah dengan kunci idempotensi per kunjungan.</p>
        {target.last_error_text && <p className="mt-3 rounded-[10px] bg-ch-bad-soft p-3 text-xs text-[#8b2020]">Kendala terakhir: {target.last_error_text}</p>}
        {retry.isError && <div className="mt-3"><Notice tone="bad">{retry.error.message} Data tetap tersimpan, Anda dapat mencoba lagi.</Notice></div>}
        <div className="mt-5 flex justify-end gap-3"><button type="button" className={btn.outline} onClick={() => { setTarget(null); retry.reset() }}>Batal</button><button type="button" className={btn.primary} disabled={retry.isPending} onClick={() => retry.mutate(target.id, { onSuccess: () => setTarget(null) })}>{retry.isPending ? 'Mengirim…' : 'Kirim Ulang'}</button></div>
      </>}
    </Dialog>
  </AppShell>
}
