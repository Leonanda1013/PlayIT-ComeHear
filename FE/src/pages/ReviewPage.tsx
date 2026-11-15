import { useState } from 'react'
import { useNavigate } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { AlertCircle, CheckCircle2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ClinicalHeader } from '@/components/ClinicalHeader'
import { saveSoap, subjectiveFields, vitalLabels } from '@/lib/clinical'
import type { Consultation } from '@/lib/types'

function ReviewSection({ title, editTo, children }: { title: string; editTo: string; children: React.ReactNode }) {
  const navigate = useNavigate()
  return <section className="rounded-2xl border border-[#D5E4E9] bg-[#F6FAFB] p-6"><div className="flex items-center justify-between gap-3"><h2 className="text-lg font-bold text-[#0C2A46]">{title}</h2><Button variant="outline" size="sm" onClick={() => navigate(editTo)}>Edit bagian ini</Button></div><div className="mt-4 space-y-3 text-sm leading-6 text-[#18293A]">{children}</div></section>
}

export function ReviewPage({ data }: { data: Consultation }) {
  const id = data.visit.id
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const note = data.note
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const warnings = [!note.subjective_summary?.trim() && 'Rangkuman Subjektif masih kosong.', !note.diagnoses?.length && 'Diagnosis primer belum ditetapkan dokter.', !note.plan_text?.trim() && 'Rencana belum diisi.'].filter(Boolean)

  async function approve() {
    if (!confirmed) { setError('Centang pernyataan pemeriksaan sebelum mengesahkan.'); return }
    setBusy(true); setError('')
    try {
      await saveSoap(id, { step: 'verifikasi', action: 'approve', confirm: 'ya' })
      await queryClient.invalidateQueries({ queryKey: ['consultation', id] })
      await queryClient.invalidateQueries({ queryKey: ['queue'] })
      navigate(`/kunjungan/${id}/resume`, { replace: true })
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'SOAP belum berhasil disahkan.') }
    finally { setBusy(false) }
  }

  async function saveDraft() {
    setBusy(true); setError(''); setNotice('')
    try { await saveSoap(id, { step: 'verifikasi', action: 'save' }); setNotice('Draf SOAP tersimpan. Belum ada pengiriman ke SATUSEHAT.') }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Draf belum tersimpan.') }
    finally { setBusy(false) }
  }

  return <div className="space-y-6"><ClinicalHeader consultation={data} stage="verifikasi" title="Tinjau & Sahkan SOAP" description="Periksa semua bagian sebelum pengesahan. Setelah disahkan, catatan tidak dapat diedit langsung." />
    {error && <p role="alert" className="rounded-lg border border-[#F8B4B4] bg-[#FDE8E8] p-3 text-sm text-[#8B2020]">{error} Draf Anda tetap tersimpan; perbaiki isian lalu coba lagi.</p>}{notice && <p role="status" className="rounded-lg border border-[#B4E0CE] bg-[#E2F3EC] p-3 text-sm text-[#136F4E]">{notice}</p>}
    {warnings.length > 0 && <div role="alert" className="rounded-xl border border-[#E8D5A0] bg-[#FFF7E2] p-4 text-sm text-[#795C18]"><p className="flex items-center gap-2 font-semibold"><AlertCircle className="size-4" /> Periksa sebelum pengesahan</p><ul className="mt-2 list-inside list-disc">{warnings.map((item) => <li key={String(item)}>{item}</li>)}</ul></div>}
    <div className="grid gap-5 xl:grid-cols-2"><ReviewSection title="S · Subjektif" editTo={`/kunjungan/${id}/draf-s`}><p>{note.subjective_summary || 'Rangkuman belum diisi.'}</p><dl className="space-y-2 border-t border-[#D5E4E9] pt-3">{subjectiveFields.map(([key, label]) => <div key={key}><dt className="font-semibold text-[#526578]">{label}</dt><dd>{note.subjective[key] || 'Belum diisi'}</dd></div>)}</dl></ReviewSection><ReviewSection title="O · Objektif" editTo={`/kunjungan/${id}/oap`}><div className="grid grid-cols-2 gap-2">{Object.entries(note.vitals).map(([key, value]) => <p key={key}><span className="text-[#526578]">{vitalLabels[key] || key}: </span>{value}</p>)}</div><p><span className="font-semibold">Pemeriksaan fisik: </span>{note.exam_text || 'Belum diisi'}</p><p><span className="font-semibold">Alergi: </span>{note.extra.alergi || 'Belum dikonfirmasi'}</p></ReviewSection><ReviewSection title="A · Asesmen" editTo={`/kunjungan/${id}/oap`}><p>{note.assessment || 'Belum diisi'}</p><div>{note.diagnoses.length ? note.diagnoses.map((diagnosis) => <p key={diagnosis.code} className="mt-2"><span className="font-semibold">{diagnosis.rank === 1 ? 'Primer' : 'Tambahan'} · {diagnosis.code}</span> — {diagnosis.display}</p>) : 'Belum ada diagnosis yang dikonfirmasi.'}</div></ReviewSection><ReviewSection title="P · Rencana" editTo={`/kunjungan/${id}/oap`}><p>{note.plan_text || 'Belum diisi'}</p><p><span className="font-semibold">Instruksi: </span>{note.extra.instruksi || '—'}</p><p><span className="font-semibold">Evaluasi: </span>{note.extra.evaluasi || '—'}</p></ReviewSection></div>
    <section className="rounded-2xl border border-[#A3DFEA] bg-[#E6F6F8] p-5"><label className="flex cursor-pointer items-start gap-3 text-sm leading-6 text-[#0C2A46]"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} className="mt-1 size-4 accent-[#0F8294]" /><span>Saya telah memeriksa identitas pasien, draf Subjektif, diagnosis, dan seluruh SOAP. Saya bertanggung jawab atas isi klinis yang disahkan.</span></label><p className="mt-3 flex items-center gap-2 text-xs text-[#526578]"><CheckCircle2 className="size-4" /> Pengiriman baru dimulai setelah dokter mengesahkan catatan.</p></section>
    <div className="flex flex-wrap justify-end gap-3"><Button variant="outline" disabled={busy} onClick={saveDraft}>Simpan draf</Button><Button disabled={busy || !confirmed || warnings.length > 0} onClick={approve} className="bg-[#0F8294] text-white hover:bg-[#0B6E7D]">{busy ? 'Mengesahkan…' : 'Sahkan & simpan'}</Button></div>
  </div>
}

