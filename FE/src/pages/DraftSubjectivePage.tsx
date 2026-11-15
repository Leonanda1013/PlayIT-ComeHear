import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, AudioLines, Check, Edit3, LoaderCircle, Mic, Pause, Play } from 'lucide-react'
import { ClinicalHeader } from '@/components/ClinicalHeader'
import { RecorderBar, TranscriptPanel } from '@/components/Scribe'
import { Badge, btn, FieldCaps, Notice, Panel, PanelTitle, TextArea } from '@/components/ui/kit'
import { apiRequest } from '@/lib/api'
import { getScribe, saveSoap, subjectiveFields, visitPath } from '@/lib/clinical'
import type { Consultation, ExtractionField } from '@/lib/types'

const statusLabel: Record<string, string> = {
  recording: 'Merekam…', queued: 'Menyiapkan transkrip…', transcribing: 'Mentranskrip percakapan…',
  extracting: 'Menyusun draf Subjektif…', coding: 'Menyusun usulan ICD-10…', done: 'Rekaman Tersimpan', failed: 'Pemrosesan gagal',
}
const PROCESSING = ['recording', 'queued', 'transcribing', 'extracting', 'coding']

export function DraftSubjectivePage({ data }: { data: Consultation }) {
  const id = data.visit.id
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [playing, setPlaying] = useState(false)
  const [fields, setFields] = useState<Record<string, string>>(data.note.subjective || {})
  const [summary, setSummary] = useState(data.note.subjective_summary || '')
  const [editing, setEditing] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [backup, setBackup] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const scribe = useQuery({
    queryKey: ['scribe', id], queryFn: () => getScribe(id), enabled: !!data.session,
    refetchInterval: (query) => PROCESSING.includes(query.state.data?.status || data.session?.status || '') ? 1500 : false,
  })
  const status = scribe.data?.status || data.session?.status || ''
  useEffect(() => { if (status === 'done' && data.session?.status !== 'done') void queryClient.invalidateQueries({ queryKey: ['consultation', id] }) }, [status, data.session?.status, queryClient, id])

  const draftFields = dirty ? fields : { ...fields, ...(scribe.data?.fields || {}) }
  const draftSummary = dirty ? summary : scribe.data?.summary || summary
  const transcript = scribe.data?.transcript?.length ? scribe.data.transcript : data.session?.transcript || []
  const suggestions = scribe.data?.icd || data.session?.icd_suggestions || []
  const extraction = (data.session?.extraction || {}) as Record<string, ExtractionField | string>
  const processing = PROCESSING.includes(status)
  const failed = status === 'failed' || !!data.failed_session

  function edit(key: string, value: string) {
    if (!dirty) { setFields(draftFields); setSummary(draftSummary); setDirty(true) }
    setFields((current) => ({ ...current, [key]: value }))
  }

  async function submitBackup() {
    if (!backup.trim()) { setError('Isi transkrip cadangan terlebih dahulu.'); return }
    setBusy(true); setError('')
    try {
      await apiRequest(visitPath(id, '/transcript-text'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ transcript: backup }) })
      await queryClient.invalidateQueries({ queryKey: ['consultation', id] }); await queryClient.invalidateQueries({ queryKey: ['scribe', id] }); setBackup('')
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Transkrip belum terkirim.') }
    finally { setBusy(false) }
  }

  async function saveAndContinue() {
    setBusy(true); setError('')
    try {
      await saveSoap(id, { step: 's', action: 'to_oap', summary: draftSummary, ...Object.fromEntries(subjectiveFields.map(([key]) => [`s_${key}`, draftFields[key] || ''])) })
      await queryClient.invalidateQueries({ queryKey: ['consultation', id] })
      navigate(`/kunjungan/${id}/objektif`)
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Koreksi Subjektif belum tersimpan.') }
    finally { setBusy(false) }
  }

  function togglePlay() {
    const audio = audioRef.current
    if (!audio) return
    if (audio.paused) { void audio.play(); setPlaying(true) } else { audio.pause(); setPlaying(false) }
  }

  return <div className="space-y-5">
    <ClinicalHeader consultation={data} stage="draf-s" />
    {error && <Notice tone="bad">{error}</Notice>}

    <RecorderBar status={processing ? statusLabel[status] : failed ? 'Pemrosesan gagal' : 'Rekaman Tersimpan'} tone={failed ? 'idle' : 'saved'} seconds={scribe.data?.duration_s || 0}
      actions={<>
        {data.session?.has_audio && <audio ref={audioRef} preload="none" src={visitPath(id, `/audio/${data.session.id}`)} onEnded={() => setPlaying(false)} />}
        <button type="button" className={`${btn.soft} h-9 text-xs`} onClick={togglePlay} disabled={!data.session?.has_audio}>{playing ? <Pause className="size-3.5" /> : <Play className="size-3 fill-current" />} {playing ? 'Jeda' : 'Putar Ulang'}</button>
        <button type="button" className={`${btn.soft} h-9 text-xs`} onClick={() => navigate(`/kunjungan/${id}/subjektif`)}><Mic className="size-3.5" /> Rekam Ulang</button>
      </>} />

    <div className="grid items-start gap-5 xl:grid-cols-[285px_minmax(0,1fr)]">
      <Panel highlight className="flex flex-col">
        <PanelTitle action={<Badge tone="info" className="py-1">Draf AI</Badge>}>Subjektif</PanelTitle>
        {processing && <p role="status" className="mt-3 flex items-center gap-2 rounded-[10px] bg-[#eef6f8] p-2.5 text-xs text-[#53697b]"><LoaderCircle className="size-4 animate-spin text-ch-brand" /> {statusLabel[status]}</p>}
        <div className="mt-3 space-y-3">
          {subjectiveFields.map(([key, label]) => {
            const meta = typeof extraction[key] === 'object' ? extraction[key] as ExtractionField : null
            const ambiguous = !dirty && meta?.status === 'ambigu'
            return <div key={key}>
              <FieldCaps>{label}</FieldCaps>
              {editing ? <TextArea rows={2} value={draftFields[key] || ''} onChange={(event) => edit(key, event.target.value)} className="text-xs" />
                : <p className={`rounded-[8px] border px-2.5 py-2 text-xs leading-5 ${ambiguous ? 'border-[#f0d08a] bg-ch-warn-soft text-[#5a4300]' : 'border-[#d6e3e9] bg-white text-ch-ink'}`}>{draftFields[key] || <span className="text-ch-faint">Tidak dibahas dalam percakapan.</span>}</p>}
              {ambiguous && <p className="mt-1 flex items-start gap-1 text-[10px] text-ch-warn"><AlertTriangle className="mt-0.5 size-3 shrink-0" /> Perlu dicek: {meta?.alasan_ambigu || 'jawaban pasien ragu-ragu.'}</p>}
            </div>
          })}
          <div><FieldCaps>Rangkuman Subjektif</FieldCaps>{editing ? <TextArea rows={4} value={draftSummary} onChange={(event) => { if (!dirty) { setFields(draftFields); setDirty(true) } setSummary(event.target.value) }} className="text-xs" /> : <p className="rounded-[8px] bg-[#eaf6f8] px-2.5 py-2 text-xs leading-5 text-[#21384b]">{draftSummary || <span className="text-ch-faint">Belum ada rangkuman.</span>}</p>}</div>
          {suggestions.length > 0 && <div><FieldCaps>Usulan ICD-10 · verifikasi dokter</FieldCaps><div className="flex flex-wrap gap-1.5">{suggestions.map((item) => <span key={item.code} title={item.alasan} className="rounded-[8px] border border-[#9ddce5] bg-[#e7f7f9] px-2 py-1.5 text-[11px] text-[#174b55]"><b>{item.code}</b> · {item.deskripsi_id || item.display}</span>)}</div></div>}
        </div>
        <div className="mt-5 flex items-center justify-between gap-2">
          <button type="button" className={`${btn.soft} h-9 text-xs`} onClick={() => setEditing(!editing)} disabled={processing}>{editing ? <Check className="size-3.5" /> : <Edit3 className="size-3.5" />}{editing ? 'Selesai edit' : 'Edit rangkuman'}</button>
          <button type="button" className={`${btn.primary} h-9 text-xs`} disabled={busy || processing} onClick={saveAndContinue}>Lanjut ke OAP</button>
        </div>
      </Panel>

      <TranscriptPanel transcript={transcript} patientName={data.visit.patient.name} badge="Transkrip sesi"
        processing={processing ? <p role="status" className="mt-3 flex items-center gap-2 rounded-[10px] bg-[#eef6f8] p-2.5 text-xs text-[#53697b]"><LoaderCircle className="size-4 animate-spin text-ch-brand" /> {statusLabel[status]}</p> : null}
        empty={<div className="text-center"><AudioLines className="mx-auto size-8 text-[#9badbf]" /><p className="mt-3 text-sm font-bold text-[#34485b]">{failed ? 'Transkrip gagal disusun' : 'Transkrip sedang disiapkan'}</p>{failed && <p className="mt-1 text-xs text-ch-muted">{data.failed_session?.error || scribe.data?.error}</p>}</div>} />
    </div>

    {(!data.session || failed) && <Panel>
      <PanelTitle sub={'Tempel transkrip per baris dengan awalan "Dokter:" atau "Pasien:" bila rekaman tidak dapat diproses.'}>Transkrip cadangan</PanelTitle>
      <TextArea value={backup} onChange={(event) => setBackup(event.target.value)} rows={5} className="mt-4" placeholder={'Dokter: Keluhannya apa?\nPasien: Pusing berputar sejak 3 hari.'} />
      <button type="button" disabled={busy} onClick={submitBackup} className={`${btn.primary} mt-3`}>Proses transkrip</button>
    </Panel>}
  </div>
}
