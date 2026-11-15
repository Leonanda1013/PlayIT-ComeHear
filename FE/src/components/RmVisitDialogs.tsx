import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, Pencil } from 'lucide-react'
import { Badge, btn, Dialog, Notice } from '@/components/ui/kit'
import { dateLong, dateShort, rmStatusMeta } from '@/lib/format'
import { confirmArrival } from '@/lib/rm'
import type { Patient, RmVisit } from '@/lib/types'

function Rows({ visit }: { visit: RmVisit }) {
  const status = rmStatusMeta[visit.rm_status]
  const rows: [string, React.ReactNode][] = [
    ['Pasien', <><b>{visit.patient.name}</b><span className="block text-xs text-ch-muted">RM {visit.patient.rm_number} · {visit.patient.gender_label}</span></>],
    ['Tanggal kunjungan', dateLong(visit.visit_date)],
    ['Poli', visit.location.poli || visit.location.name],
    ['Dokter', visit.doctor || '—'],
    ['Jenis kunjungan', visit.visit_type === 'Baru' ? 'Pasien Baru' : visit.visit_type],
    ['Status', <Badge tone={status.tone}>{status.label}</Badge>],
  ]
  if (visit.admin_note) rows.push(['Catatan administratif', visit.admin_note])
  return <dl className="divide-y divide-[#e8eff2] rounded-[12px] border border-[#d6e3e9] bg-ch-field px-4">{rows.map(([k, v]) => <div key={k} className="grid grid-cols-[150px_1fr] gap-3 py-2.5 text-[13px]"><dt className="text-ch-muted">{k}</dt><dd>{v}</dd></div>)}</dl>
}

export function useConfirmArrival() {
  const queryClient = useQueryClient()
  const [target, setTarget] = useState<RmVisit | null>(null)
  const [done, setDone] = useState('')
  const mutation = useMutation({
    mutationFn: (id: number) => confirmArrival(id),
    onSuccess: async (data) => { setDone(data.message); await queryClient.invalidateQueries({ queryKey: ['rm-visits'] }); await queryClient.invalidateQueries({ queryKey: ['queue'] }) },
  })
  const close = () => { setTarget(null); setDone(''); mutation.reset() }
  const dialog = <Dialog open={!!target} onClose={close} title={done ? 'Kedatangan dikonfirmasi' : 'Konfirmasi kedatangan pasien'}>
    {target && (done ? <div className="text-center"><CheckCircle2 className="mx-auto size-10 text-ch-ok" /><p className="mt-3 text-sm">{done}</p><p className="mt-1 text-xs text-ch-muted">Pasien kini muncul pada antrean dokter.</p><button type="button" className={`${btn.primary} mt-5 w-full`} onClick={close}>Selesai</button></div> : <>
      <p className="mb-3 text-[13px] text-ch-muted">Periksa data berikut. Konfirmasi mengubah status <b>Terjadwal</b> menjadi <b>Menunggu Pemeriksaan</b>.</p>
      <Rows visit={target} />
      {mutation.isError && <div className="mt-3"><Notice tone="bad">{mutation.error.message}</Notice></div>}
      <div className="mt-5 flex justify-end gap-3"><button type="button" className={btn.outline} onClick={close}>Batal</button><button type="button" className={btn.primary} disabled={mutation.isPending} onClick={() => mutation.mutate(target.id)}>{mutation.isPending ? 'Mengonfirmasi…' : 'Konfirmasi Kedatangan'}</button></div>
    </>)}
  </Dialog>
  return { open: setTarget, dialog }
}

export function VisitDetailDialog({ visit, onClose, onConfirm, onEditPatient }: { visit: RmVisit | null; onClose: () => void; onConfirm?: (v: RmVisit) => void; onEditPatient?: (p: Patient) => void }) {
  return <Dialog open={!!visit} onClose={onClose} title="Detail kunjungan" width={560}>
    {visit && <>
      <Rows visit={visit} />
      <p className="mt-3 text-[11px] text-ch-muted">Kode kunjungan {visit.code} · terdaftar {dateShort(visit.arrived_at)}. Detail SOAP hanya dapat dibaca melalui Riwayat Pasien.</p>
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        {onEditPatient ? (
          <button type="button" className="inline-flex h-9 items-center gap-1.5 rounded-[8px] border border-[#d2e1e7] bg-white px-3 text-xs font-semibold text-[#3d5266] hover:border-ch-brand hover:text-ch-teal" onClick={() => onEditPatient(visit.patient)}>
            <Pencil className="size-3.5" /> Edit Data Pasien
          </button>
        ) : <div />}
        <div className="flex gap-2">
          <button type="button" className={btn.outline} onClick={onClose}>Tutup</button>
          {onConfirm && visit.rm_status === 'terjadwal' && <button type="button" className={btn.primary} onClick={() => { onClose(); onConfirm(visit) }}>Konfirmasi Kedatangan</button>}
        </div>
      </div>
    </>}
  </Dialog>
}
