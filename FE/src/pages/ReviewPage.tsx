import { useState } from 'react'
import { useNavigate } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { AlertCircle, ShieldCheck } from 'lucide-react'
import { ClinicalHeader } from '@/components/ClinicalHeader'
import { SoapSummary } from '@/components/SoapSummary'
import { btn, Notice } from '@/components/ui/kit'
import { saveSoap } from '@/lib/clinical'
import { applyFinish, QUEUE_KEY } from '@/lib/queue'
import type { Consultation, QueueResponse } from '@/lib/types'

export function ReviewPage({ data }: { data: Consultation }) {
  const id = data.visit.id
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const note = data.note
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const warnings = [
    !note.subjective_summary?.trim() && !Object.values(note.subjective || {}).some((v) => String(v).trim()) && 'Subjektif masih kosong.',
    !note.diagnoses?.length && 'Diagnosis utama dengan kode ICD-10 belum ditetapkan.',
    !note.plan_text?.trim() && 'Plan belum diisi.',
  ].filter(Boolean) as string[]

  async function approve() {
    if (!confirmed) { setError('Centang pernyataan pemeriksaan sebelum menyimpan.'); return }
    setBusy(true); setError('')
    try {
      await saveSoap(id, { step: 'verifikasi', action: 'approve', confirm: 'ya' })
      // Antrean langsung diperbarui: pasien ini "selesai", pasien menunggu berikutnya menjadi "saat ini".
      queryClient.setQueryData<QueueResponse>(QUEUE_KEY, (prev) => prev && { ...prev, rows: applyFinish(prev.rows, id) })
      await Promise.all([queryClient.invalidateQueries({ queryKey: ['consultation', id] }), queryClient.invalidateQueries({ queryKey: QUEUE_KEY })])
      navigate(`/kunjungan/${id}/resume`, { replace: true })
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'SOAP belum berhasil disimpan.') }
    finally { setBusy(false) }
  }

  async function saveDraft() {
    setBusy(true); setError(''); setNotice('')
    try { await saveSoap(id, { step: 'verifikasi', action: 'save' }); setNotice('Draf SOAP tersimpan. Belum ada pengiriman ke SATUSEHAT.') }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Draf belum tersimpan.') }
    finally { setBusy(false) }
  }

  return <div className="space-y-5">
    <ClinicalHeader consultation={data} stage="verifikasi" />
    {error && <Notice tone="bad">{error} Draf tetap tersimpan; perbaiki isian lalu coba lagi.</Notice>}
    {notice && <Notice>{notice}</Notice>}
    {warnings.length > 0 && <div role="alert" className="rounded-[12px] border border-[#f0d08a] bg-ch-warn-soft p-4 text-sm text-[#6b4f00]"><p className="flex items-center gap-2 font-semibold"><AlertCircle className="size-4" /> Lengkapi sebelum validasi</p><ul className="mt-2 list-inside list-disc text-[13px]">{warnings.map((item) => <li key={item}>{item}</li>)}</ul></div>}

    <SoapSummary note={note} editBase={`/kunjungan/${id}`} aiDraft={!!data.session} />

    <section className="rounded-[16px] border border-[#a3dfea] bg-[#e6f6f8] p-5">
      <label className="flex cursor-pointer items-start gap-3 text-[13px] leading-6 text-ch-ink"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} className="mt-1 size-4 accent-ch-brand" /><span>Saya telah memeriksa identitas pasien, draf Subjektif dari AI, diagnosis, dan seluruh SOAP. Saya bertanggung jawab atas isi klinis yang disimpan.</span></label>
      <p className="mt-2 flex items-center gap-2 text-xs text-ch-muted"><ShieldCheck className="size-4 text-ch-teal" /> Setelah disimpan, SOAP terkunci, audio rekaman dihapus, dan pengiriman ke SATUSEHAT dimulai.</p>
    </section>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <button type="button" className={btn.outline} onClick={() => navigate(`/kunjungan/${id}/asesmen`)}>Kembali</button>
      <div className="flex gap-3"><button type="button" className={btn.outline} disabled={busy} onClick={saveDraft}>Simpan Draf</button><button type="button" disabled={busy || !confirmed || warnings.length > 0} onClick={approve} className={btn.primary}>{busy ? 'Menyimpan…' : 'Simpan'}</button></div>
    </div>
  </div>
}
