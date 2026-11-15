import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AudioLines, Edit3, LoaderCircle, Mic, Play, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ClinicalHeader } from '@/components/ClinicalHeader'
import { ErrorState } from '@/components/Feedback'
import { apiRequest } from '@/lib/api'
import { getScribe, saveSoap, subjectiveFields, visitPath } from '@/lib/clinical'
import type { Consultation, TranscriptSegment } from '@/lib/types'

const statusLabel: Record<string, string> = { queued: 'Menunggu proses', transcribing: 'Mentranskrip percakapan…', extracting: 'Menyusun Subjektif…', coding: 'Menyusun usulan ICD-10…', done: 'Rekaman Tersimpan', failed: 'Pemrosesan gagal' }

export function DraftSubjectivePage({ data }: { data: Consultation }) {
  const id = data.visit.id
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [fields, setFields] = useState<Record<string, string>>(data.note.subjective)
  const [summary, setSummary] = useState(data.note.subjective_summary)
  const [editing, setEditing] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [backup, setBackup] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const scribe = useQuery({ queryKey: ['scribe', id], queryFn: () => getScribe(id), enabled: !!data.session, refetchInterval: (query) => ['recording', 'queued', 'transcribing', 'extracting', 'coding'].includes(query.state.data?.status || '') ? 1500 : false })
  useEffect(() => { if (scribe.data?.status === 'done' && data.session?.status !== 'done') void queryClient.invalidateQueries({ queryKey: ['consultation', id] }) }, [scribe.data?.status, data.session?.status, queryClient, id])

  const status = scribe.data?.status || data.session?.status || ''
  const draftFields = dirty ? fields : scribe.data?.fields || fields
  const draftSummary = dirty ? summary : scribe.data?.summary || summary
  const transcript: TranscriptSegment[] = scribe.data?.transcript?.length ? scribe.data.transcript : data.session?.transcript || []
  const suggestions = scribe.data?.icd || data.session?.icd_suggestions || []
  const duration = scribe.data?.duration_s || 0
  const durationLabel = `${Math.floor(duration / 60).toString().padStart(2, '0')}:${Math.floor(duration % 60).toString().padStart(2, '0')}`
  const processing = ['recording', 'queued', 'transcribing', 'extracting', 'coding'].includes(status)

  async function submitBackup() {
    if (!backup.trim()) { setError('Isi transkrip cadangan terlebih dahulu.'); return }
    setBusy(true); setError('')
    try { await apiRequest(visitPath(id, '/transcript-text'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ transcript: backup }) }); await queryClient.invalidateQueries({ queryKey: ['consultation', id] }); await queryClient.invalidateQueries({ queryKey: ['scribe', id] }); setBackup('') }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Transkrip belum terkirim.') }
    finally { setBusy(false) }
  }

  async function saveAndContinue() {
    setBusy(true); setError('')
    try { await saveSoap(id, { step: 's', action: 'to_oap', summary: draftSummary, ...Object.fromEntries(subjectiveFields.map(([key]) => [`s_${key}`, draftFields[key] || ''])) }); await queryClient.invalidateQueries({ queryKey: ['consultation', id] }); navigate(`/kunjungan/${id}/oap`) }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Koreksi Subjektif belum tersimpan.') }
    finally { setBusy(false) }
  }

  return <div className="space-y-6"><ClinicalHeader consultation={data} stage="draf-s" />
    {error && <p role="alert" className="rounded-xl border border-[#f2b8b8] bg-[#fff0f0] p-3 text-sm text-[#9d2525]">{error}</p>}
    <section className="flex min-h-[116px] flex-wrap items-center gap-5 rounded-2xl border border-[#d2e1e7] bg-[#fbfdfe] px-5 py-5">
      <div className="flex items-center gap-5"><span className="inline-flex h-10 items-center gap-2 rounded-xl border border-[#79d8e4] bg-[#ddf6f9] px-4 text-xs font-bold text-[#08798a]"><span className="size-2 rounded-full bg-[#128da0]" /> {processing ? statusLabel[status] : 'Rekaman Tersimpan'}</span><strong className="text-[20px] tabular-nums text-[#3f4c55]">{durationLabel} <small className="text-xs font-semibold text-[#687982]">menit</small></strong></div>
      <div className="hidden h-px flex-1 border-t border-dashed border-[#18abc0] lg:block" />
      {data.session?.has_audio && <audio ref={audioRef} preload="none" src={visitPath(id, `/audio/${data.session.id}`)} />}
      <div className="ml-auto flex gap-3"><Button variant="outline" className="h-10 rounded-xl bg-[#f1f6f8] text-xs" onClick={() => audioRef.current?.play()} disabled={!data.session?.has_audio}><Play className="size-3.5 fill-current" /> Putar Ulang</Button><Button variant="outline" className="h-10 rounded-xl bg-[#f1f6f8] text-xs" onClick={() => navigate(`/kunjungan/${id}/subjektif`)}><Mic className="size-4" /> Rekam Ulang</Button></div>
    </section>

    {scribe.isError && <ErrorState message={scribe.error.message} onRetry={() => scribe.refetch()} />}
    <div className="grid items-start gap-5 xl:grid-cols-[1.2fr_1fr]">
      <section className="rounded-2xl border border-[#d2e1e7] bg-[#fbfdfe] p-5"><div className="flex items-center justify-between"><h2 className="text-[20px] font-bold text-[#101f35]">Transkrip Percakapan</h2><span className="rounded-full border border-[#cad9e3] bg-[#edf2f6] px-3 py-1.5 text-[11px] font-semibold text-[#52677b]">Transkrip sesi</span></div>
        {processing && <p role="status" className="mt-5 flex items-center gap-2 rounded-xl bg-[#eef6f8] p-3 text-sm text-[#53697b]"><LoaderCircle className="size-4 animate-spin text-[#0ea5b7]" /> {statusLabel[status]}</p>}
        <div className="mt-5 max-h-[760px] space-y-3 overflow-auto pr-1">{transcript.length ? transcript.map((segment, index) => <TranscriptBubble key={index} segment={segment} patientName={data.visit.patient.name} />) : <div className="grid min-h-[260px] place-items-center rounded-xl border border-dashed border-[#d4e2e9] text-center"><div><AudioLines className="mx-auto size-8 text-[#9badbf]" /><p className="mt-3 text-sm font-bold text-[#34485b]">Transkrip sedang disiapkan</p></div></div>}</div>
      </section>

      <section className="rounded-2xl border-2 border-[#0ea5b7] bg-[#fbfdfe] p-5"><div className="flex items-center justify-between"><h2 className="text-[20px] font-bold text-[#101f35]">Subjektif</h2><span className="rounded-full border border-[#79d8e4] bg-[#ddf6f9] px-3 py-1.5 text-[11px] font-semibold text-[#08798a]">Draf AI</span></div>
        <div className="mt-5 space-y-3">{subjectiveFields.map(([key, label]) => <label key={key} className="block text-[9px] font-bold uppercase tracking-wide text-[#687c91]">{label}{editing ? <textarea rows={2} value={draftFields[key] || ''} onChange={(event) => { setSummary(draftSummary); setDirty(true); setFields({ ...draftFields, [key]: event.target.value }) }} className="mt-1.5 w-full rounded-lg border border-[#d2e1e7] bg-white p-2.5 text-xs font-normal normal-case tracking-normal text-[#152a3e] outline-none focus:border-[#0ea5b7]" /> : <p className="mt-1.5 rounded-lg border border-[#d5e2e8] bg-[#f9fbfc] p-2.5 text-xs font-medium normal-case tracking-normal text-[#152a3e]">{draftFields[key] || 'Belum ada informasi.'}</p>}</label>)}</div>
        {draftSummary && <div className="mt-4 rounded-xl bg-[#eaf6f8] p-3"><p className="text-[9px] font-bold uppercase tracking-wide text-[#687c91]">Rangkuman</p><p className="mt-1 text-xs leading-5 text-[#21384b]">{draftSummary}</p></div>}
        {suggestions.length > 0 && <div className="mt-4"><p className="text-[9px] font-bold uppercase tracking-wide text-[#687c91]">Usulan ICD-10 · perlu verifikasi dokter</p><div className="mt-2 flex flex-wrap gap-2">{suggestions.map((item) => <span key={item.code} className="rounded-lg border border-[#9ddce5] bg-[#e7f7f9] px-2.5 py-2 text-[11px] text-[#174b55]"><b>{item.code}</b> · {item.deskripsi_id || item.display}</span>)}</div></div>}
        <div className="mt-5 flex flex-wrap justify-end gap-3"><Button variant="outline" className="rounded-xl" onClick={() => setEditing(!editing)}>{editing ? <RotateCcw className="size-4" /> : <Edit3 className="size-4" />}{editing ? 'Selesai edit' : 'Edit rangkuman'}</Button><Button disabled={busy || processing} onClick={saveAndContinue} className="rounded-xl bg-[#14a2b5] text-white hover:bg-[#0c8fa1]">Lanjut ke Objektif</Button></div>
      </section>
    </div>

    {(!data.session || status === 'failed') && <section className="rounded-2xl border border-[#d2e1e7] bg-[#fbfdfe] p-5"><h2 className="font-bold text-[#102a43]">Transkrip cadangan</h2><p className="mt-1 text-xs text-[#60758a]">Masukkan transkrip per baris dengan awalan “Dokter:” atau “Pasien:”.</p><textarea value={backup} onChange={(event) => setBackup(event.target.value)} rows={5} className="mt-4 w-full rounded-xl border border-[#d2e1e7] bg-white p-3 text-sm outline-none focus:border-[#0ea5b7]" /><Button disabled={busy} onClick={submitBackup} className="mt-3 bg-[#14a2b5]">Proses transkrip</Button></section>}
  </div>
}

function TranscriptBubble({ segment, patientName }: { segment: TranscriptSegment; patientName: string }) {
  const patient = segment.speaker === 'patient'
  const label = patient ? `Pasien (${patientName})` : 'Dokter'
  return <div className={`flex items-start gap-2 ${patient ? '' : 'flex-row-reverse'}`}><span className={`grid size-6 shrink-0 place-items-center rounded-full text-[10px] font-bold text-white ${patient ? 'bg-[#17a5b7]' : 'bg-[#102a43]'}`}>{patient ? 'P' : 'D'}</span><div className={`w-[86%] rounded-xl border px-3 py-2.5 ${patient ? 'border-[#b9e6ec] bg-[#e5f7f9]' : 'border-[#d3e1e7] bg-[#f0f4f6]'}`}><p className={`text-[11px] font-semibold ${patient ? 'text-[#00a0b5]' : 'text-[#34495d]'}`}>{label}</p><p className="mt-1 text-xs leading-5 text-[#152a3e]">{segment.text}</p></div></div>
}
