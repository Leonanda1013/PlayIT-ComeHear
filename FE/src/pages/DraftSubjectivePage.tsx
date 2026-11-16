import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, AudioLines, Check, LoaderCircle, Mic, Pause, Play } from 'lucide-react'
import { ClinicalHeader } from '@/components/ClinicalHeader'
import { ConsentBlock, useConsent } from '@/components/Consent'
import { TranscriptBubble } from '@/components/Scribe'
import { Notice, TextArea } from '@/components/ui/kit'
import { apiRequest } from '@/lib/api'
import { getScribe, saveSoap, subjectiveFields, visitPath } from '@/lib/clinical'
import { mmss } from '@/lib/format'
import type { Consultation, ExtractionField } from '@/lib/types'

const statusLabel: Record<string, string> = {
  recording: 'Merekam…', queued: 'Menyiapkan transkrip…', transcribing: 'Mentranskrip percakapan…',
  extracting: 'Menyusun draf Subjektif…', coding: 'Menyusun usulan ICD-10…', done: 'Rekaman Tersimpan', failed: 'Pemrosesan gagal',
}
const PROCESSING = ['recording', 'queued', 'transcribing', 'extracting', 'coding']

/** Label tampilan bagian S (mengikuti desain); field kosong yang opsional disembunyikan. */
const S_LABELS: [string, string, boolean][] = [
  ['keluhan_utama', 'Keluhan utama', true],
  ['riwayat_penyakit_sekarang', 'Riwayat penyakit sekarang', true],
  ['riwayat_penyakit_dahulu', 'Riwayat penyakit dahulu', true],
  ['riwayat_penyakit_keluarga', 'Riwayat penyakit keluarga', false],
  ['riwayat_alergi', 'Riwayat alergi', true],
  ['riwayat_pengobatan', 'Riwayat penggunaan obat', true],
]

export function DraftSubjectivePage({ data }: { data: Consultation }) {
  const id = data.visit.id
  const navigate = useNavigate()
  const location = useLocation()
  const queryClient = useQueryClient()
  const redirectReason = (location.state as { redirectReason?: string } | null)?.redirectReason ||
    new URLSearchParams(location.search).get('alasan')
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [playing, setPlaying] = useState(false)
  const [fields, setFields] = useState<Record<string, string>>(data.note.subjective || {})
  const [summary, setSummary] = useState(data.note.subjective_summary || '')
  const [editing, setEditing] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [backup, setBackup] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const {
    consent,
    decide,
    givenByName,
    setGivenByName,
    relation,
    setRelation,
    saved,
  } = useConsent(data, setError)
  const scribe = useQuery({
    queryKey: ['scribe', id], queryFn: () => getScribe(id), enabled: !!data.session,
    refetchInterval: (query) => PROCESSING.includes(query.state.data?.status || data.session?.status || '') ? 1500 : false,
  })
  const status = scribe.data?.status || data.session?.status || ''
  useEffect(() => { if (status === 'done' && data.session?.status !== 'done') void queryClient.invalidateQueries({ queryKey: ['consultation', id] }) }, [status, data.session?.status, queryClient, id])

  const draftFields = dirty ? fields : { ...fields, ...(scribe.data?.fields || {}) }
  const draftSummary = dirty ? summary : scribe.data?.summary || summary
  const transcript = scribe.data?.transcript?.length ? scribe.data.transcript : data.session?.transcript || []
  const extraction = (data.session?.extraction || {}) as Record<string, ExtractionField | string>
  const processing = PROCESSING.includes(status)
  const failed = status === 'failed' || (!data.session && !!data.failed_session)

  function onDecide(decision: 'setuju' | 'tolak', customGiver?: string, customRel?: string) {
    decide(decision, customGiver, customRel)
    // Menolak perekaman = pencatatan manual di halaman S.
    if (decision === 'tolak') {
      void saved().then(() => navigate(`/kunjungan/${id}/subjektif`, {
        state: { redirectReason: 'Persetujuan diubah menjadi manual (tolak perekaman). Anda dialihkan ke halaman Subjektif manual.' }
      }))
    }
  }

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
      await saved()
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

  const soft = 'inline-flex h-9 items-center gap-2 rounded-[8px] border border-[#dce6eb] bg-[#eef4f7] px-4 text-[14px] font-medium text-[#3d5266] hover:border-ch-brand hover:text-ch-teal disabled:opacity-50'
  const pillLabel = processing ? statusLabel[status] : failed ? 'Pemrosesan Gagal' : 'Rekaman Tersimpan'

  return <div className="space-y-[25px]">
    <ClinicalHeader
      consultation={data}
      stage="draf-s"
      patientExtra={
        <ConsentBlock
          consent={consent}
          onDecide={onDecide}
          patientName={data.visit.patient.name}
          givenByName={givenByName}
          relation={relation}
          onUpdateGiver={(name, rel) => {
            setGivenByName(name)
            setRelation(rel)
          }}
        />
      }
    />
    {redirectReason && <Notice tone="info">{redirectReason}</Notice>}
    {error && <Notice tone="bad">{error}</Notice>}

    <section className="flex min-h-[115px] flex-wrap items-center gap-4 rounded-[16px] border border-[#dce6eb] bg-[#fbfdfe] px-[19px] py-4" aria-live="polite">
      <span className={`inline-flex h-[38px] items-center gap-2.5 rounded-[8px] border px-3.5 text-[14px] font-semibold ${failed ? 'border-[#f3b6b6] bg-ch-bad-soft text-ch-bad' : 'border-[#9adbe5] bg-[#d9f3f6] text-[#0b6e7d]'}`}>{processing ? <LoaderCircle className="size-4 animate-spin" /> : <span className={`size-2 rounded-full ${failed ? 'bg-ch-bad' : 'bg-[#0b6e7d]'}`} />}{pillLabel}</span>
      <p className="font-inter text-[22px] font-bold tabular-nums text-[#3f4c55]">{mmss(scribe.data?.duration_s || 0)} <span className="font-jakarta text-[15px] font-semibold text-[#5f7284]">menit</span></p>
      <div className="mx-auto hidden h-px w-[265px] border-t-2 border-dashed border-[#5cc9d8] lg:block" aria-hidden />
      <div className="ml-auto flex flex-wrap gap-4">
        {data.session?.has_audio && <audio ref={audioRef} preload="none" src={visitPath(id, `/audio/${data.session.id}`)} onEnded={() => setPlaying(false)} />}
        <button type="button" className={soft} onClick={togglePlay} disabled={!data.session?.has_audio}>{playing ? <Pause className="size-3.5" /> : <Play className="size-3 fill-current" />} {playing ? 'Jeda' : 'Putar Ulang'}</button>
        <button type="button" className={soft} onClick={() => navigate(`/kunjungan/${id}/subjektif`)}><Mic className="size-4" /> Rekam Ulang</button>
      </div>
    </section>

    <div className="grid items-start gap-[25px] xl:grid-cols-[592fr_486fr]">
      <section className="rounded-[16px] border border-[#dce6eb] bg-[#fbfdfe] px-5 pb-5 pt-[19px]">
        <div className="flex items-center justify-between gap-3"><h2 className="text-[20px] font-bold text-ch-ink">Transkrip Percakapan</h2><span className="inline-flex h-[30px] items-center rounded-full border border-[#cfdbe2] bg-[#edf2f5] px-3 text-[13px] font-semibold text-[#4b5f70]">Transkrip sesi</span></div>
        {processing && !transcript.length && <p role="status" className="mt-4 flex items-center gap-2 rounded-[10px] bg-[#eef6f8] p-3 text-[13px] text-[#53697b]"><LoaderCircle className="size-4 animate-spin text-ch-brand" /> {statusLabel[status]}</p>}
        {transcript.length ? <div className="mt-4 space-y-3">{transcript.map((segment, index) => <TranscriptBubble key={segment.i ?? index} segment={segment} patientName={data.visit.patient.name} doctorName={data.visit.doctor} />)}</div>
          : !processing && <div className="mt-4 grid min-h-[260px] place-items-center rounded-[12px] border border-dashed border-[#d6e1e7] text-center"><div><AudioLines className="mx-auto size-8 text-[#9badbf]" /><p className="mt-3 text-[13px] font-semibold text-[#2f4053]">{failed ? 'Transkrip gagal disusun' : 'Transkrip belum tersedia'}</p>{failed && <p className="mt-1 px-6 text-[12px] text-ch-muted">{data.failed_session?.error || scribe.data?.error}</p>}</div></div>}
      </section>

      <section className="rounded-[16px] border border-ch-brand bg-[#fbfdfe] px-4 pb-[19px] pt-[22px]">
        <div className="flex items-center justify-between gap-3"><h2 className="text-[20px] font-bold text-ch-ink">Subjektif</h2><span className="inline-flex h-[30px] items-center rounded-full border border-[#8fd6e1] bg-[#dff4f7] px-3 text-[13px] font-semibold text-[#0b6e7d]">Draf AI</span></div>
        {processing && <p role="status" className="mt-3 flex items-center gap-2 rounded-[8px] bg-[#eef6f8] p-2.5 text-[12px] text-[#53697b]"><LoaderCircle className="size-4 animate-spin text-ch-brand" /> {statusLabel[status]}</p>}
        <div className="mt-[18px] space-y-[13px]">
          {S_LABELS.filter(([key, , always]) => always || draftFields[key]).map(([key, label]) => {
            const meta = typeof extraction[key] === 'object' ? extraction[key] as ExtractionField : null
            const ambiguous = !dirty && meta?.status === 'ambigu'
            return <div key={key}>
              <p className="mb-[7px] text-[9px] font-semibold uppercase leading-3 tracking-[0.04em] text-[#5f7284]">{label}</p>
              {editing ? <TextArea rows={2} value={draftFields[key] || ''} onChange={(event) => edit(key, event.target.value)} className="rounded-[8px] px-2 py-2 text-[12px] leading-[18px]" />
                : <p className={`min-h-[33px] rounded-[8px] border px-2 py-[7px] text-[12px] leading-[18px] ${ambiguous ? 'border-[#f0d08a] bg-ch-warn-soft text-[#5a4300]' : 'border-[#dce6eb] bg-white text-ch-ink'}`}>{draftFields[key] || <span className="text-ch-faint">Tidak dibahas dalam percakapan.</span>}</p>}
              {ambiguous && <p className="mt-1 flex items-start gap-1 text-[10px] text-ch-warn"><AlertTriangle className="mt-0.5 size-3 shrink-0" /> Perlu dicek: {meta?.alasan_ambigu || 'jawaban pasien ragu-ragu.'}</p>}
            </div>
          })}
        </div>
        <div className="mt-[13px] flex items-center justify-center gap-14">
          <button type="button" className="inline-flex h-9 min-w-[127px] items-center justify-center gap-1.5 rounded-[8px] border border-[#dce6eb] bg-[#eef4f7] px-4 text-[14px] font-medium text-[#3d5266] hover:border-ch-brand disabled:opacity-50" onClick={() => setEditing(!editing)} disabled={processing}>{editing && <Check className="size-4" />}{editing ? 'Selesai edit' : 'Edit rangkuman'}</button>
          <button type="button" className="inline-flex h-9 min-w-[140px] items-center justify-center rounded-[8px] bg-ch-brand px-4 text-[14px] font-semibold text-white hover:bg-ch-brand-hover disabled:opacity-50" disabled={busy || processing} onClick={saveAndContinue}>{busy ? 'Menyimpan…' : 'Lanjut ke Objektif'}</button>
        </div>
      </section>
    </div>

    {(!data.session || failed) && <section className="rounded-[16px] border border-[#dce6eb] bg-[#fbfdfe] p-5">
      <h2 className="text-[16px] font-bold">Transkrip cadangan</h2>
      <p className="mt-1 text-[12px] text-ch-muted">Tempel transkrip per baris dengan awalan "Dokter:" atau "Pasien:" bila rekaman tidak dapat diproses.</p>
      <TextArea value={backup} onChange={(event) => setBackup(event.target.value)} rows={5} className="mt-3" placeholder={'Dokter: Keluhannya apa?\nPasien: Pusing berputar sejak 3 hari.'} />
      <button type="button" disabled={busy} onClick={submitBackup} className="mt-3 inline-flex h-10 items-center rounded-[10px] bg-ch-brand px-4 text-sm font-semibold text-white hover:bg-ch-brand-hover disabled:opacity-50">Proses transkrip</button>
    </section>}
  </div>
}
