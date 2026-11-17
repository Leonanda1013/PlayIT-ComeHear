import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, ChevronDown, ChevronRight, Pencil, RefreshCw, Send, ShieldAlert } from 'lucide-react'
import { Link } from 'react-router'
import type { SessionProps } from '@/App'
import { AppShell } from '@/components/AppShell'
import { PageTitle } from '@/components/ClinicalHeader'
import { EditPatientDialog } from '@/components/EditPatientDialog'
import { EmptyState, ErrorState, LoadingState } from '@/components/Feedback'
import { Badge, btn, Dialog, Notice, Panel, SelectInput } from '@/components/ui/kit'
import { dateShort, submissionMeta, timeWib } from '@/lib/format'
import { getSatusehat, requeueSubmission } from '@/lib/rm'
import type { Patient, SatusehatRow } from '@/lib/types'

const PROCESS = ['QUEUED', 'SENDING', 'RETRY_WAIT', 'RECONCILING']

export type IssueCategory = 'ok' | 'proses' | 'transient' | 'identitas' | 'klinis' | 'teknis'

/** Kategori kendala (DESIGN.md §4): menentukan tindakan berikutnya. */
function issue(row: SatusehatRow, isCorrected: boolean): { label: string; action: string; category: IssueCategory; retry: boolean } {
  if (row.status === 'SENT') return { label: '—', action: 'Tidak perlu tindakan', category: 'ok', retry: false }
  if (PROCESS.includes(row.status)) return { label: 'Sedang diproses', action: 'Tunggu proses selesai', category: 'proses', retry: row.status === 'RETRY_WAIT' }
  const code = `${row.last_error_code || ''} ${row.last_error_text || ''}`.toLowerCase()
  if (/timeout|5\d\d|koneksi|connect|transport/.test(code)) return { label: 'Gangguan sementara', action: 'Kirim ulang', category: 'transient', retry: true }
  if (/patient|pasien|ihs|nik|identitas/.test(code)) {
    return {
      label: 'Data administratif (Identitas)',
      action: isCorrected ? 'Bundle baru siap dikirim ulang' : 'Koreksi identitas sebelum kirim ulang',
      category: 'identitas',
      retry: isCorrected, // Hanya aktif setelah koreksi selesai
    }
  }
  if (/condition|icd|diagnos|observation|klinis/.test(code)) return { label: 'Data klinis', action: 'Kembalikan ke dokter', category: 'klinis', retry: false }
  return { label: 'Masalah teknis', action: 'Teruskan ke tim integrasi', category: 'teknis', retry: true }
}

export function SatusehatPage({ user, onLogout }: SessionProps) {
  const queryClient = useQueryClient()
  const [status, setStatus] = useState('')
  const [target, setTarget] = useState<SatusehatRow | null>(null)
  const [expandedRowId, setExpandedRowId] = useState<number | null>(null)
  const [editingPatient, setEditingPatient] = useState<{ patient: Patient; subId: number } | null>(null)
  const [correctedSubIds, setCorrectedSubIds] = useState<Set<number>>(() => new Set())
  const [correctionNotice, setCorrectionNotice] = useState<string | null>(null)

  const sync = useQuery({ queryKey: ['satusehat'], queryFn: getSatusehat, refetchInterval: 15_000 })
  const retry = useMutation({
    mutationFn: (id: number) => requeueSubmission(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['satusehat'] })
    },
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
      {correctionNotice && <div className="mt-3"><Notice tone="ok"><CheckCircle2 className="mr-1.5 inline size-4" />{correctionNotice}</Notice></div>}
      {retry.isSuccess && <div className="mt-3"><Notice>Pengiriman dimasukkan kembali ke antrean kirim.</Notice></div>}
      <div className="mt-3 overflow-x-auto"><div className="min-w-[1020px]">
        <div className="grid grid-cols-[1.2fr_95px_1fr_150px_1.8fr_140px] items-center gap-x-5 rounded-[8px] bg-[#e8f0f3] px-3 py-2.5 text-[11px] font-semibold text-[#3f5468]"><span>Pasien</span><span>Tanggal</span><span>Dokter</span><span>Status</span><span>Kendala</span><span className="text-right">Aksi</span></div>
        {sync.isPending ? <LoadingState /> : sync.isError ? <ErrorState message={sync.error.message} onRetry={() => sync.refetch()} /> : rows.length === 0 ? <EmptyState title={all.length ? 'Tidak ada pengiriman dengan status ini' : 'Belum ada pengiriman'} description={all.length ? 'Pilih status lain.' : 'Rekam medis dikirim otomatis setelah dokter memvalidasi SOAP.'} /> : <div className="divide-y divide-[#dde8ec]">
          {rows.map((r) => {
            const meta = submissionMeta(r.status)
            const isCorrected = correctedSubIds.has(r.id)
            const it = issue(r, isCorrected)
            const isIdentity = it.category === 'identitas'
            const isIhsNotFound = r.status === 'NEEDS_ATTENTION' && (
              (r.last_error_code || '').toLowerCase().includes('ihs_not_found') ||
              (r.last_error_text || '').toLowerCase().includes('ihs_not_found') ||
              ((r.last_error_text || '').toLowerCase().includes('nomor ihs') && (r.last_error_text || '').toLowerCase().includes('nik'))
            )
            const canRetry = it.retry && r.status !== 'SENT' && !PROCESS.includes(r.status)
            const isExpanded = expandedRowId === r.id

            return <div key={r.id}>
              <div className="grid min-h-[58px] grid-cols-[1.2fr_95px_1fr_150px_1.8fr_140px] items-center gap-x-5 px-3 py-2.5 text-[12px]">
              <div><p className="text-[13px] font-semibold">{r.patient?.name || '—'}</p><p className="text-[10px] text-ch-muted">RM-{r.patient?.rm_number} · {r.visit_code}</p></div>
              <span>{dateShort(r.visit_date)}</span>
              <span className="text-ch-muted">{r.doctor}</span>
              <span><Badge tone={meta.tone === 'info' ? 'info' : meta.tone}>{meta.label}</Badge></span>
              <div className="flex flex-col items-start gap-0.5">
                <div className="flex flex-wrap items-center gap-1.5">
                  <p className="font-semibold text-ch-ink">{isIhsNotFound ? 'Nomor IHS pasien belum ditemukan' : it.label}</p>
                  {isIdentity && isCorrected && <Badge tone="ok" className="text-[9px] py-0 px-1.5">Bundle Koreksi Siap</Badge>}
                </div>
                {isIhsNotFound && r.patient && !isCorrected ? (
                  <button type="button" onClick={() => setEditingPatient({ patient: r.patient!, subId: r.id })} className="inline-flex items-center gap-1 text-[11px] font-semibold text-ch-teal hover:underline">
                    Periksa identitas <span aria-hidden="true">→</span>
                  </button>
                ) : <p className="text-[10px] text-ch-muted">{it.action}</p>}
              </div>
              <div className="flex items-center justify-end gap-2">
                {/* Tombol Kirim Ulang: aktif langsung untuk transient, atau setelah koreksi untuk error identitas */}
                {canRetry && (
                  <button
                    type="button"
                    onClick={() => setTarget(r)}
                    className="inline-flex h-7 items-center gap-1 rounded-[7px] bg-ch-brand px-2.5 text-[11px] font-semibold text-white hover:bg-ch-brand-hover"
                  >
                    <Send className="size-3" /> Kirim Ulang
                  </button>
                )}
                <button type="button" aria-expanded={isExpanded} aria-controls={`satusehat-detail-${r.id}`} onClick={() => setExpandedRowId(isExpanded ? null : r.id)} className="inline-flex shrink-0 items-center gap-0.5 text-[11px] font-semibold text-ch-teal hover:underline">
                  Lihat detail <ChevronDown className={`size-3.5 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                </button>
              </div>
              </div>
              {isExpanded && <div id={`satusehat-detail-${r.id}`} className="mx-3 mb-3 rounded-[8px] border border-[#d3e2e8] bg-[#f7fafb] p-3 text-[11px]">
                <p className="font-semibold text-ch-ink">Detail pengiriman SATUSEHAT</p>
                <dl className="mt-2 grid gap-2 sm:grid-cols-3">
                  <div><dt className="text-ch-muted">Kode error</dt><dd className="break-words font-mono text-ch-ink">{r.last_error_code || '—'}</dd></div>
                  <div><dt className="text-ch-muted">Pesan teknis</dt><dd className="break-words font-mono text-ch-ink">{r.last_error_text || '—'}</dd></div>
                  <div><dt className="text-ch-muted">Jumlah percobaan</dt><dd className="text-ch-ink">{r.attempts} percobaan</dd></div>
                </dl>
                <Link to={`/rm/riwayat/${r.visit_id}`} className="mt-3 inline-flex items-center gap-0.5 font-semibold text-ch-teal hover:underline">Lihat rekam medis <ChevronRight className="size-3.5" /></Link>
              </div>}
            </div>
          })}
        </div>}
      </div></div>
    </Panel>

    {/* Dialog Kirim Ulang */}
    <Dialog open={!!target} onClose={() => { setTarget(null); retry.reset() }} title="Kirim ulang ke SATUSEHAT?">
      {target && (() => {
        const isTargetCorrected = correctedSubIds.has(target.id)
        const targetIssue = issue(target, isTargetCorrected)
        const isIdentity = targetIssue.category === 'identitas'
        const requireCorrectionFirst = isIdentity && !isTargetCorrected

        return <>
          <p className="text-sm text-ch-muted">
            Rekam medis <b className="text-ch-ink">{target.patient?.name}</b> ({target.visit_code}) akan dimasukkan kembali ke antrean kirim SATUSEHAT.
          </p>

          {target.last_error_text && (
            <div className="mt-3 rounded-[10px] bg-ch-bad-soft p-3 text-xs text-[#8b2020]">
              <p className="font-semibold">Detail Kendala Terakhir:</p>
              <p className="mt-1 font-mono">{target.last_error_text}</p>
            </div>
          )}

          {requireCorrectionFirst ? (
            <div className="mt-3 rounded-[10px] border border-[#f0c27b] bg-[#fffaf0] p-3 text-xs text-[#92400e]">
              <div className="flex items-start gap-2">
                <ShieldAlert className="size-4 shrink-0 text-[#d97706] mt-0.5" />
                <div>
                  <p className="font-semibold">Perbaikan Identitas Diperlukan</p>
                  <p className="mt-1">
                    Error identitas tidak dapat dikirim ulang dengan bundle lama. Anda harus melakukan koreksi identitas pasien terlebih dahulu agar bundle baru dapat disusun dan divalidasi.
                  </p>
                </div>
              </div>
              <div className="mt-3 flex justify-end">
                <button
                  type="button"
                  onClick={() => {
                    const p = target.patient
                    const subId = target.id
                    setTarget(null)
                    if (p) setEditingPatient({ patient: p, subId })
                  }}
                  className="inline-flex h-8 items-center gap-1.5 rounded-[8px] bg-[#d97706] px-3 text-[12px] font-semibold text-white hover:bg-[#b45309]"
                >
                  <Pencil className="size-3" /> Koreksi Identitas Sekarang
                </button>
              </div>
            </div>
          ) : (
            <p className="mt-2 text-xs text-ch-muted">
              {isIdentity && isTargetCorrected
                ? 'Bundle koreksi baru telah disusun berdasarkan data identitas terkini dan siap dikirim.'
                : 'Pengiriman ganda dicegah dengan kunci idempotensi per kunjungan.'}
            </p>
          )}

          {retry.isError && (
            <div className="mt-3">
              <Notice tone="bad">{retry.error.message} Data tetap tersimpan, Anda dapat mencoba lagi.</Notice>
            </div>
          )}

          <div className="mt-5 flex justify-end gap-3">
            <button type="button" className={btn.outline} onClick={() => { setTarget(null); retry.reset() }}>
              Batal
            </button>
            <button
              type="button"
              className={btn.primary}
              disabled={retry.isPending || requireCorrectionFirst}
              onClick={() => retry.mutate(target.id, { onSuccess: () => setTarget(null) })}
            >
              {retry.isPending ? 'Mengirim…' : 'Kirim Ulang'}
            </button>
          </div>
        </>
      })()}
    </Dialog>

    {/* Dialog Koreksi Identitas Pasien */}
    <EditPatientDialog
      patient={editingPatient?.patient || null}
      open={!!editingPatient}
      onClose={() => setEditingPatient(null)}
      onSuccess={(updated) => {
        if (editingPatient) {
          setCorrectedSubIds((prev) => new Set([...prev, editingPatient.subId]))
          setCorrectionNotice(`Identitas pasien ${updated.name} berhasil diperbarui. Bundle koreksi baru siap dikirim ulang.`)
        }
        setEditingPatient(null)
      }}
    />
  </AppShell>
}
