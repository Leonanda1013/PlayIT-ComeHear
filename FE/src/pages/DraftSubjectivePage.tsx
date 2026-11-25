import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, AudioLines, Check, CheckCircle2, LoaderCircle, Mic, Pause, Play, Quote, RefreshCw, X } from 'lucide-react'
import { ClinicalHeader } from '@/components/ClinicalHeader'
import { ConsentBlock, useConsent } from '@/components/Consent'
import { TranscriptBubble } from '@/components/Scribe'
import { Notice, TextArea } from '@/components/ui/kit'
import { apiRequest } from '@/lib/api'
import { getScribe, retryScribe, saveSoap, subjectiveFields, visitPath } from '@/lib/clinical'
import { mmss } from '@/lib/format'
import type { Consultation, ExtractionField } from '@/lib/types'

const statusLabel: Record<string, string> = {
  recording: 'Merekam…', queued: 'Menyiapkan transkrip…', transcribing: 'Mentranskrip percakapan…', refining: 'Menyempurnakan transkrip…',
  extracting: 'Menyusun draf Subjektif…', coding: 'Menyusun usulan ICD-10…', done: 'Rekaman Tersimpan', failed: 'Pemrosesan gagal',
}
const PROCESSING = ['recording', 'queued', 'transcribing', 'refining', 'extracting', 'coding']

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
    queryKey: ['scribe', id], queryFn: () => getScribe(id), enabled: !!(data.session || data.failed_session),
    refetchInterval: (query) => PROCESSING.includes(query.state.data?.status || data.session?.status || '') ? 1500 : false,
  })
  const status = scribe.data?.status || data.session?.status || ''
  useEffect(() => { if ((status === 'done' || status === 'failed') && data.session?.status !== status) void queryClient.invalidateQueries({ queryKey: ['consultation', id] }) }, [status, data.session?.status, queryClient, id])

  const draftFields = dirty ? fields : { ...fields, ...(scribe.data?.fields || {}) }
  const draftSummary = dirty ? summary : scribe.data?.summary || summary
  const transcript = scribe.data?.transcript?.length ? scribe.data.transcript : data.session?.transcript || []
  const extraction = (scribe.data?.extraction || data.session?.extraction || {}) as Record<string, ExtractionField | string | unknown>
  const processing = PROCESSING.includes(status)
  const failed = status === 'failed' || (!data.session && !!data.failed_session)

  async function retryProcessing() {
    const sessionId = data.failed_session?.id || data.session?.id
    if (!sessionId || busy) return
    setBusy(true); setError('')
    try {
      await saved()
      await retryScribe(id, sessionId)
      await queryClient.invalidateQueries({ queryKey: ['consultation', id] })
      await queryClient.invalidateQueries({ queryKey: ['scribe', id] })
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Pemrosesan belum berhasil diulang.')
    } finally { setBusy(false) }
  }

  const [activeCitation, setActiveCitation] = useState<{
    fieldKey: string
    fieldLabel: string
    segmentIds: number[]
    quote?: string | null
  } | null>(null)

  // Peta indeks segmen -> daftar label field Subjektif yang mengutip segmen tersebut
  const citationsBySegment: Record<number, string[]> = {}
  const firstFieldBySegment: Record<number, { key: string; label: string; ids: number[]; quote?: string | null }> = {}
  for (const [key, label] of S_LABELS) {
    const meta = typeof extraction[key] === 'object' && extraction[key] !== null ? (extraction[key] as ExtractionField) : null
    const sids = meta?.source_ids || []
    for (const sid of sids) {
      if (!citationsBySegment[sid]) citationsBySegment[sid] = []
      if (!citationsBySegment[sid].includes(label)) citationsBySegment[sid].push(label)
      if (!firstFieldBySegment[sid]) {
        firstFieldBySegment[sid] = { key, label, ids: sids, quote: meta?.kutipan }
      }
    }
  }

  const deniedSymptoms = Array.isArray(extraction.gejala_disangkal)
    ? (extraction.gejala_disangkal as string[]).filter(Boolean)
    : []

  function focusCitation(
    fieldKey: string,
    fieldLabel: string,
    segmentIds: number[],
    quote?: string | null,
    targetSegId?: number,
  ) {
    if (
      activeCitation?.fieldKey === fieldKey &&
      targetSegId === undefined &&
      activeCitation.segmentIds.join(',') === segmentIds.join(',')
    ) {
      setActiveCitation(null)
      return
    }
    setActiveCitation({ fieldKey, fieldLabel, segmentIds, quote })
    const scrollTarget = targetSegId ?? segmentIds[0]
    if (scrollTarget !== undefined) {
      const el = document.getElementById(`transcript-seg-${scrollTarget}`)
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }
    }
  }

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

  const soft = 'inline-flex h-9 shrink-0 items-center gap-2 whitespace-nowrap rounded-[8px] border border-[#dce6eb] bg-[#eef4f7] px-3 text-[14px] font-medium text-[#3d5266] hover:border-ch-brand hover:text-ch-teal disabled:opacity-50'
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

    <section className="flex min-h-[88px] flex-wrap items-center gap-3 rounded-[16px] border border-[#dce6eb] bg-[#fbfdfe] px-[19px] py-4 lg:flex-nowrap" aria-live="polite">
      <span className={`inline-flex h-[38px] shrink-0 items-center gap-2.5 whitespace-nowrap rounded-[8px] border px-3.5 text-[14px] font-semibold ${failed ? 'border-[#f3b6b6] bg-ch-bad-soft text-ch-bad' : 'border-[#9adbe5] bg-[#d9f3f6] text-[#0b6e7d]'}`}>{processing ? <LoaderCircle className="size-4 animate-spin" /> : <span className={`size-2 rounded-full ${failed ? 'bg-ch-bad' : 'bg-[#0b6e7d]'}`} />}{pillLabel}</span>
      <p className="shrink-0 whitespace-nowrap font-inter text-[22px] font-bold tabular-nums text-[#3f4c55]">{mmss(scribe.data?.duration_s || 0)} <span className="font-jakarta text-[15px] font-semibold text-[#5f7284]">menit</span></p>
      <div className="mx-auto hidden h-0 max-w-[120px] flex-1 border-t-2 border-dashed border-[#5cc9d8] lg:block" aria-hidden />
      <div className="ml-auto flex flex-wrap items-center gap-2 lg:flex-nowrap">
        {data.session?.has_audio && <audio ref={audioRef} preload="none" src={visitPath(id, `/audio/${data.session.id}`)} onEnded={() => setPlaying(false)} />}
        <button type="button" className={soft} onClick={togglePlay} disabled={!data.session?.has_audio}>{playing ? <Pause className="size-3.5" /> : <Play className="size-3 fill-current" />} {playing ? 'Jeda' : 'Putar Ulang'}</button>
        {failed && <button type="button" className={soft} disabled={busy || consent !== 'setuju'} onClick={retryProcessing}><RefreshCw className={`size-4 ${busy ? 'animate-spin' : ''}`} />{busy ? 'Mencoba Lagi…' : 'Coba Proses Lagi'}</button>}
        {(status === 'recording' || (status === 'done' && data.session?.has_audio)) && <button type="button" className={soft} disabled={busy} onClick={() => navigate(`/kunjungan/${id}/subjektif`, { state: { resumeSessionId: data.session?.id } })}><Play className="size-4" /> Lanjutkan Rekaman</button>}
        <button type="button" className={soft} disabled={busy || processing} onClick={() => navigate(`/kunjungan/${id}/subjektif`)}><Mic className="size-4" /> Rekam Ulang</button>
      </div>
    </section>

    <div className="grid items-start gap-[25px] xl:grid-cols-[592fr_486fr]">
      <section className="rounded-[16px] border border-[#dce6eb] bg-[#fbfdfe] px-5 pb-5 pt-[19px]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-[20px] font-bold text-ch-ink">Transkrip Percakapan</h2>
          <span className="inline-flex h-[30px] items-center rounded-full border border-[#cfdbe2] bg-[#edf2f5] px-3 text-[13px] font-semibold text-[#4b5f70]">Transkrip sesi</span>
        </div>
        {activeCitation && (
          <div className="mt-3 flex items-center justify-between gap-2 rounded-[10px] border border-[#8fd6e1] bg-[#dff4f7] px-3 py-2 text-[12px] text-[#086775]">
            <span className="flex items-center gap-1.5 font-medium">
              <Quote className="size-3.5 shrink-0 text-[#0b6e7d]" />
              Menyorot bukti sitasi untuk <b className="font-bold">{activeCitation.fieldLabel}</b> ({activeCitation.segmentIds.map((sid) => `[${sid}]`).join(', ')})
            </span>
            <button
              type="button"
              onClick={() => setActiveCitation(null)}
              className="inline-flex items-center gap-1 rounded-[6px] border border-[#8fd6e1] bg-white px-2 py-0.5 text-[11px] font-semibold text-[#0b6e7d] hover:bg-[#eef9fb]"
            >
              <X className="size-3" /> Reset
            </button>
          </div>
        )}
        {processing && !transcript.length && <p role="status" className="mt-4 flex items-center gap-2 rounded-[10px] bg-[#eef6f8] p-3 text-[13px] text-[#53697b]"><LoaderCircle className="size-4 animate-spin text-ch-brand" /> {statusLabel[status]}</p>}
        {transcript.length ? (
          <div className="mt-4 space-y-3">
            {transcript.map((segment, index) => {
              const segIdx = segment.i ?? index
              const isHighlighted = Boolean(activeCitation?.segmentIds.includes(segIdx))
              const citedFields = citationsBySegment[segIdx] || []
              const firstCitation = firstFieldBySegment[segIdx]
              return (
                <TranscriptBubble
                  key={segIdx}
                  segment={{ ...segment, i: segIdx }}
                  patientName={data.visit.patient.name}
                  doctorName={data.visit.doctor}
                  highlighted={isHighlighted}
                  highlightQuote={isHighlighted ? activeCitation?.quote : null}
                  citedFields={citedFields}
                  onClick={
                    firstCitation
                      ? () => focusCitation(firstCitation.key, firstCitation.label, firstCitation.ids, firstCitation.quote)
                      : undefined
                  }
                />
              )
            })}
          </div>
        ) : !processing && <div className="mt-4 grid min-h-[260px] place-items-center rounded-[12px] border border-dashed border-[#d6e1e7] text-center"><div><AudioLines className="mx-auto size-8 text-[#9badbf]" /><p className="mt-3 text-[13px] font-semibold text-[#2f4053]">{failed ? 'Transkrip gagal disusun' : 'Transkrip belum tersedia'}</p>{failed && <p className="mt-1 px-6 text-[12px] text-ch-muted">{data.failed_session?.error || scribe.data?.error}</p>}</div></div>}
      </section>

      <section className="rounded-[16px] border border-ch-brand bg-[#fbfdfe] px-4 pb-[19px] pt-[22px]">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-[20px] font-bold text-ch-ink">Subjektif</h2>
          <span className="inline-flex h-[30px] items-center rounded-full border border-[#8fd6e1] bg-[#dff4f7] px-3 text-[13px] font-semibold text-[#0b6e7d]">Draf AI • Grounded</span>
        </div>
        {processing && <p role="status" className="mt-3 flex items-center gap-2 rounded-[8px] bg-[#eef6f8] p-2.5 text-[12px] text-[#53697b]"><LoaderCircle className="size-4 animate-spin text-ch-brand" /> {statusLabel[status]}</p>}
        <div className="mt-[18px] space-y-[14px]">
          {S_LABELS.filter(([key, , always]) => always || draftFields[key]).map(([key, label]) => {
            const meta = typeof extraction[key] === 'object' && extraction[key] !== null ? (extraction[key] as ExtractionField) : null
            const ambiguous = !dirty && meta?.status === 'ambigu'
            const sourceIds = meta?.source_ids || []
            const quoteText = meta?.kutipan || (meta?.sitasi?.[0]?.text ?? null)
            const groundingScore = typeof meta?.grounding === 'number' ? Math.round(meta.grounding * 100) : null
            const isFieldActive = activeCitation?.fieldKey === key

            return <div
              key={key}
              className={`rounded-[10px] transition-colors ${isFieldActive ? 'bg-[#eef9fb] p-2 -mx-2 ring-1 ring-[#8fd6e1]' : ''}`}
            >
              <div className="mb-[7px] flex flex-wrap items-center justify-between gap-1.5">
                <p className="text-[9px] font-semibold uppercase leading-3 tracking-[0.04em] text-[#5f7284]">{label}</p>
                {!dirty && (sourceIds.length > 0 || groundingScore !== null) && (
                  <div className="flex flex-wrap items-center gap-1">
                    {groundingScore !== null && (
                      <span
                        title={`Skor verifikasi bukti kutipan terhadap transkrip: ${groundingScore}%`}
                        className={`inline-flex items-center gap-1 rounded-[5px] border px-1.5 py-0.5 text-[9px] font-semibold ${
                          ambiguous || groundingScore < 80
                            ? 'border-[#f0d08a] bg-[#fff8e6] text-[#8a6100]'
                            : 'border-[#9adbe5] bg-[#e6f7f9] text-[#086775]'
                        }`}
                      >
                        <CheckCircle2 className="size-2.5" />
                        {groundingScore}%
                      </span>
                    )}
                    {sourceIds.map((sid) => {
                      const isSegActive = isFieldActive && activeCitation?.segmentIds.includes(sid)
                      return (
                        <button
                          key={sid}
                          type="button"
                          onClick={() => focusCitation(key, label, sourceIds, quoteText, sid)}
                          title={`Klik untuk menyorot Segmen [${sid}] di Transkrip Percakapan`}
                          className={`inline-flex items-center gap-1 rounded-[5px] border px-1.5 py-0.5 font-inter text-[10px] font-bold transition-colors ${
                            isSegActive
                              ? 'border-[#0b6e7d] bg-[#0b6e7d] text-white'
                              : 'border-[#8fd6e1] bg-[#dff4f7] text-[#0b6e7d] hover:bg-[#c5ecf2]'
                          }`}
                        >
                          <Quote className="size-2.5" /> [{sid}]
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
              {editing ? <TextArea rows={2} value={draftFields[key] || ''} onChange={(event) => edit(key, event.target.value)} className="rounded-[8px] px-2 py-2 text-[12px] leading-[18px]" />
                : <p className={`min-h-[33px] rounded-[8px] border px-2.5 py-[7px] text-[12px] leading-[18px] ${ambiguous ? 'border-[#f0d08a] bg-ch-warn-soft text-[#5a4300]' : 'border-[#dce6eb] bg-white text-ch-ink'}`}>{draftFields[key] || <span className="text-ch-faint">Tidak dibahas dalam percakapan.</span>}</p>}
              {!editing && !dirty && quoteText && (
                <button
                  type="button"
                  onClick={() => focusCitation(key, label, sourceIds, quoteText)}
                  className={`mt-1.5 flex w-full items-start gap-1.5 rounded-[7px] border px-2.5 py-1.5 text-left text-[11px] leading-[15px] transition-colors ${
                    isFieldActive
                      ? 'border-[#5cc9d8] bg-[#dff4f7] text-[#075461]'
                      : 'border-[#e1ecf0] bg-[#f4f9fb] text-[#4a6073] hover:border-[#9adbe5] hover:bg-[#eaf6f9]'
                  }`}
                >
                  <Quote className="mt-0.5 size-3 shrink-0 text-[#0b8597]" />
                  <span className="min-w-0 flex-1">
                    <span className="font-semibold text-[#0b6e7d]">
                      Sitasi {sourceIds.length ? `Segmen ${sourceIds.map((s) => `[${s}]`).join(', ')}` : 'Transkrip'}:
                    </span>{' '}
                    <span className="italic">“{quoteText}”</span>
                  </span>
                </button>
              )}
              {ambiguous && <p className="mt-1 flex items-start gap-1 text-[10px] text-ch-warn"><AlertTriangle className="mt-0.5 size-3 shrink-0" /> Perlu dicek: {meta?.alasan_ambigu || 'jawaban pasien ragu-ragu.'}</p>}
            </div>
          })}

          {deniedSymptoms.length > 0 && (
            <div className="pt-1">
              <p className="mb-[7px] text-[9px] font-semibold uppercase leading-3 tracking-[0.04em] text-[#5f7284]">
                Gejala yang Disangkal (Pertinent Negatives)
              </p>
              <div className="flex flex-wrap gap-1.5 rounded-[8px] border border-[#dce6eb] bg-white px-2.5 py-2">
                {deniedSymptoms.map((symptom) => (
                  <span
                    key={symptom}
                    className="inline-flex items-center rounded-full border border-[#d0dfe6] bg-[#f0f5f8] px-2.5 py-0.5 text-[11px] font-medium text-[#3d5266]"
                  >
                    ✕ {symptom} (disangkal)
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
        <div className="mt-[15px] flex items-center justify-center gap-14">
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
